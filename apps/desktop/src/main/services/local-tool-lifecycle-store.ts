import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  LocalToolAssetRecord,
  LocalToolHealthState,
  LocalToolInstalledTargetRecord,
  LocalToolLifecycleRecord
} from "./local-tool-manager-types";

const MAX_RECORD_BYTES = 1024 * 1024;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,79}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export class LocalToolLifecycleStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalToolLifecycleStoreError";
    this.code = code;
  }
}

export class LocalToolLifecycleStore {
  readonly #rootPath: string;
  readonly #trustedAppDataRoot: string;

  constructor(rootPath: string, trustedAppDataRoot: string) {
    if (!path.isAbsolute(rootPath) || !path.isAbsolute(trustedAppDataRoot)) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_root_invalid",
        "Local-tool root must be an app-owned absolute path."
      );
    }
    this.#rootPath = path.resolve(rootPath);
    this.#trustedAppDataRoot = path.resolve(trustedAppDataRoot);
    if (
      this.#rootPath === this.#trustedAppDataRoot ||
      !this.#rootPath.startsWith(`${this.#trustedAppDataRoot}${path.sep}`)
    ) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_root_invalid",
        "Local-tool root must be contained by the trusted app-data root."
      );
    }
  }

  prepare(): void {
    this.#assertTrustedBoundary();
    createOwnedDirectory(this.#rootPath);
    for (const directory of ["records", "installs", "assets", "staging", "quarantine"]) {
      createOwnedDirectory(path.join(this.#rootPath, directory));
    }
  }

  read(toolId: string): LocalToolLifecycleRecord | undefined {
    this.#assertTrustedBoundary();
    const recordPath = this.recordPath(toolId);
    if (!fs.existsSync(recordPath)) return undefined;
    const stats = fs.lstatSync(recordPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_RECORD_BYTES) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_record_invalid",
        "Local-tool lifecycle record is unavailable or invalid."
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    } catch {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_record_invalid",
        "Local-tool lifecycle record is invalid JSON."
      );
    }
    const record = parseLocalToolLifecycleRecord(value);
    if (record.toolId !== toolId) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_record_invalid",
        "Local-tool lifecycle record identity does not match its owner."
      );
    }
    return record;
  }

  readAllValid(): LocalToolLifecycleRecord[] {
    this.prepare();
    const records: LocalToolLifecycleRecord[] = [];
    for (const entry of fs.readdirSync(this.recordsRoot(), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const toolId = entry.name.slice(0, -5);
      if (!SAFE_ID_PATTERN.test(toolId)) continue;
      try {
        const record = this.read(toolId);
        if (record) records.push(record);
      } catch {
        // Invalid records never route capabilities and remain for explicit repair.
      }
    }
    return records;
  }

  write(record: LocalToolLifecycleRecord): void {
    this.prepare();
    const parsed = parseLocalToolLifecycleRecord(record);
    writeJsonAtomic(this.recordPath(parsed.toolId), parsed);
  }

  recordPath(toolId: string): string {
    return path.join(this.recordsRoot(), `${requireSafeId(toolId, "toolId")}.json`);
  }

  stagingPath(requestId: string): string {
    return path.join(this.stagingRoot(), requireSafeRequestId(requestId));
  }

  quarantineRequestPath(requestId: string): string {
    return path.join(this.quarantineRoot(), requireSafeRequestId(requestId));
  }

  targetRelativePath(input: {
    readonly toolId: string;
    readonly assetId?: string;
    readonly version: string;
    readonly packageSha256: string;
  }): string {
    const toolId = requireSafeId(input.toolId, "toolId");
    const version = requireSafeVersion(input.version);
    const digest = requireSha256(input.packageSha256).slice("sha256:".length);
    if (input.assetId) {
      return `assets/${toolId}/${requireSafeId(input.assetId, "assetId")}/${version}-${digest}`;
    }
    return `installs/${toolId}/${version}-${digest}`;
  }

  absoluteOwnedPath(relativePath: string): string {
    return resolveOwnedRelativePath(this.#rootPath, relativePath);
  }

  verifiedOwnedPath(relativePath: string): string {
    const resolved = this.absoluteOwnedPath(relativePath);
    assertOwnedSegmentsWithoutSymlink(this.#rootPath, relativePath);
    return resolved;
  }

  publishStaging(stagingPath: string, targetRelativePath: string): string {
    const stagingRelativePath = path.relative(this.#rootPath, stagingPath).split(path.sep).join("/");
    const expectedStaging = resolveOwnedRelativePath(this.#rootPath, stagingRelativePath);
    const stagingRoot = this.stagingRoot();
    if (!expectedStaging.startsWith(`${stagingRoot}${path.sep}`)) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_path_escape",
        "Local-tool staging path escapes its owned root."
      );
    }
    const targetPath = this.absoluteOwnedPath(targetRelativePath);
    createOwnedSubdirectory(this.#rootPath, path.dirname(targetPath));
    fs.renameSync(stagingPath, targetPath);
    fsyncDirectoryIfSupported(path.dirname(targetPath));
    fsyncDirectoryIfSupported(stagingRoot);
    return targetPath;
  }

  quarantineOwnedPath(relativePath: string, requestId: string, label: string): string | undefined {
    const sourcePath = this.absoluteOwnedPath(relativePath);
    assertOwnedParentSegmentsWithoutSymlink(this.#rootPath, relativePath);
    if (!fs.existsSync(sourcePath)) return undefined;
    const quarantinePath = this.quarantineRequestPath(requestId);
    createOwnedDirectory(quarantinePath);
    const safeLabel = requireSafeLabel(label);
    const targetPath = path.join(quarantinePath, `${safeLabel}-${randomUUID()}`);
    fs.renameSync(sourcePath, targetPath);
    fsyncDirectoryIfSupported(path.dirname(sourcePath));
    fsyncDirectoryIfSupported(quarantinePath);
    return targetPath;
  }

  restoreQuarantinedPath(quarantinePath: string, targetRelativePath: string): void {
    const quarantineRoot = this.quarantineRoot();
    const resolvedQuarantine = path.resolve(quarantinePath);
    if (!resolvedQuarantine.startsWith(`${quarantineRoot}${path.sep}`)) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_path_escape",
        "Local-tool quarantine path escapes its owned root."
      );
    }
    const targetPath = this.absoluteOwnedPath(targetRelativePath);
    if (fs.existsSync(targetPath)) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_version_conflict",
        "Local-tool target already exists during rollback."
      );
    }
    createOwnedSubdirectory(this.#rootPath, path.dirname(targetPath));
    fs.renameSync(resolvedQuarantine, targetPath);
    fsyncDirectoryIfSupported(path.dirname(targetPath));
  }

  discardStaging(requestId: string): void {
    const stagingPath = this.stagingPath(requestId);
    fs.rmSync(stagingPath, { recursive: true, force: true });
    fsyncDirectoryIfSupported(this.stagingRoot());
  }

  recoverOwnedEntries(requestId: string, lifecycleJobId: string, updatedAt: string): number {
    this.prepare();
    const referenced = collectReferencedPaths(this.readAllValid());
    let recovered = 0;

    for (const entry of fs.readdirSync(this.stagingRoot(), { withFileTypes: true })) {
      const relativePath = `staging/${entry.name}`;
      if (this.quarantineOwnedPath(relativePath, requestId, "staging")) recovered += 1;
    }

    for (const relativePath of this.listPublishedVersionPaths()) {
      if (referenced.has(relativePath)) continue;
      if (this.quarantineOwnedPath(relativePath, requestId, "orphan")) recovered += 1;
    }

    for (const record of this.readAllValid()) {
      const pending = record.cleanupPendingRelativePaths ?? [];
      if (pending.length === 0) continue;
      let changed = false;
      for (const relativePath of pending) {
        if (this.quarantineOwnedPath(relativePath, requestId, "removed")) recovered += 1;
        changed = true;
      }
      if (changed) {
        this.write({
          ...record,
          cleanupPendingRelativePaths: [],
          updatedAt,
          lastLifecycleJobId: lifecycleJobId
        });
      }
    }

    return recovered;
  }

  listPublishedVersionPaths(): string[] {
    this.prepare();
    const paths: string[] = [];
    const installsRoot = this.installsRoot();
    for (const toolEntry of fs.readdirSync(installsRoot, { withFileTypes: true })) {
      if (!toolEntry.isDirectory() || toolEntry.isSymbolicLink()) continue;
      const toolPath = path.join(installsRoot, toolEntry.name);
      for (const versionEntry of fs.readdirSync(toolPath, { withFileTypes: true })) {
        if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) continue;
        paths.push(`installs/${toolEntry.name}/${versionEntry.name}`);
      }
    }
    const assetsRoot = this.assetsRoot();
    for (const toolEntry of fs.readdirSync(assetsRoot, { withFileTypes: true })) {
      if (!toolEntry.isDirectory() || toolEntry.isSymbolicLink()) continue;
      const toolPath = path.join(assetsRoot, toolEntry.name);
      for (const assetEntry of fs.readdirSync(toolPath, { withFileTypes: true })) {
        if (!assetEntry.isDirectory() || assetEntry.isSymbolicLink()) continue;
        const assetPath = path.join(toolPath, assetEntry.name);
        for (const versionEntry of fs.readdirSync(assetPath, { withFileTypes: true })) {
          if (!versionEntry.isDirectory() || versionEntry.isSymbolicLink()) continue;
          paths.push(`assets/${toolEntry.name}/${assetEntry.name}/${versionEntry.name}`);
        }
      }
    }
    return paths;
  }

  recordsRoot(): string {
    return path.join(this.#rootPath, "records");
  }

  stagingRoot(): string {
    return path.join(this.#rootPath, "staging");
  }

  quarantineRoot(): string {
    return path.join(this.#rootPath, "quarantine");
  }

  installsRoot(): string {
    return path.join(this.#rootPath, "installs");
  }

  assetsRoot(): string {
    return path.join(this.#rootPath, "assets");
  }

  #assertTrustedBoundary(): void {
    if (!fs.existsSync(this.#trustedAppDataRoot)) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_root_invalid",
        "Trusted app-data root is unavailable."
      );
    }
    const trustedStats = fs.lstatSync(this.#trustedAppDataRoot);
    if (!trustedStats.isDirectory() || trustedStats.isSymbolicLink()) {
      throw new LocalToolLifecycleStoreError(
        "settings.local_tool_root_invalid",
        "Trusted app-data root must be a non-symlink directory."
      );
    }
    const relative = path.relative(this.#trustedAppDataRoot, this.#rootPath);
    let current = this.#trustedAppDataRoot;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if (!fs.existsSync(current)) return;
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new LocalToolLifecycleStoreError(
          "settings.local_tool_symlink_rejected",
          "Local-tool root cannot traverse symbolic-link descendants of app data."
        );
      }
      if (!stats.isDirectory()) {
        throw new LocalToolLifecycleStoreError(
          "settings.local_tool_root_invalid",
          "Local-tool root descendants must be directories."
        );
      }
    }
  }
}

export function parseLocalToolLifecycleRecord(value: unknown): LocalToolLifecycleRecord {
  const record = requireObject(value, "record");
  assertExactKeys(record, [
    "schemaVersion",
    "toolId",
    "installState",
    "enabled",
    "activeVersion",
    "activeManifestSha256",
    "activeRelativePath",
    "platform",
    "architecture",
    "capabilities",
    "license",
    "sizeBytes",
    "assets",
    "health",
    "cleanupPendingRelativePaths",
    "updatedAt",
    "lastLifecycleJobId"
  ], "record");
  if (record.schemaVersion !== 1) fail("settings.local_tool_record_invalid", "Unsupported lifecycle record schema.");
  const toolId = requireSafeId(record.toolId, "toolId");
  const base = parseInstalledTargetRecord(record, false);
  assertTargetPathOwnership(base, toolId);
  const assets = requireArray(record.assets, "assets", 256)
    .map((asset, index) => parseAssetRecord(asset, index, toolId));
  const seenAssets = new Set<string>();
  for (const asset of assets) {
    if (seenAssets.has(asset.assetId)) fail("settings.local_tool_record_invalid", "Asset IDs must be unique.");
    seenAssets.add(asset.assetId);
  }
  const cleanupPendingRelativePaths = record.cleanupPendingRelativePaths === undefined
    ? undefined
    : requireArray(record.cleanupPendingRelativePaths, "cleanupPendingRelativePaths", 256)
      .map((entry) => requireOwnedRelativePath(entry));
  for (const relativePath of cleanupPendingRelativePaths ?? []) {
    const ownedByTool = relativePath.startsWith(`installs/${toolId}/`);
    const ownedByAsset = assets.some((asset) => relativePath.startsWith(`assets/${toolId}/${asset.assetId}/`));
    if (!ownedByTool && !ownedByAsset) {
      fail("settings.local_tool_record_invalid", "Cleanup path is outside this tool's install ownership.");
    }
  }
  const updatedAt = requireIsoDate(record.updatedAt, "updatedAt");
  const lastLifecycleJobId = requireString(record.lastLifecycleJobId, "lastLifecycleJobId", 1, 120);
  return {
    schemaVersion: 1,
    toolId,
    ...base,
    assets,
    ...(cleanupPendingRelativePaths ? { cleanupPendingRelativePaths } : {}),
    updatedAt,
    lastLifecycleJobId
  };
}

function parseAssetRecord(value: unknown, index: number, toolId: string): LocalToolAssetRecord {
  const record = requireObject(value, `assets[${index}]`);
  assertExactKeys(record, [
    "assetId",
    "installState",
    "enabled",
    "activeVersion",
    "activeManifestSha256",
    "activeRelativePath",
    "platform",
    "architecture",
    "capabilities",
    "license",
    "sizeBytes",
    "health"
  ], `assets[${index}]`);
  const assetId = requireSafeId(record.assetId, `assets[${index}].assetId`);
  const parsed = parseInstalledTargetRecord(record, true);
  assertTargetPathOwnership(parsed, toolId, assetId);
  return { assetId, ...parsed };
}

function assertTargetPathOwnership(
  record: LocalToolInstalledTargetRecord,
  toolId: string,
  assetId?: string
): void {
  if (!record.activeRelativePath) return;
  const version = requireSafeVersion(record.activeVersion);
  const digest = requireSha256(record.activeManifestSha256).slice("sha256:".length);
  const expected = assetId
    ? `assets/${toolId}/${assetId}/${version}-${digest}`
    : `installs/${toolId}/${version}-${digest}`;
  if (record.activeRelativePath !== expected) {
    fail("settings.local_tool_record_invalid", "Lifecycle active path is not bound to its tool identity.");
  }
}

function parseInstalledTargetRecord(
  record: Record<string, unknown>,
  asset: boolean
): LocalToolInstalledTargetRecord {
  const installState = requireEnum(
    record.installState,
    ["available", "installed", "repair_needed", "error"] as const,
    "installState"
  );
  const enabled = requireBoolean(record.enabled, "enabled");
  const activeVersion = record.activeVersion === undefined ? undefined : requireSafeVersion(record.activeVersion);
  const activeManifestSha256 = record.activeManifestSha256 === undefined
    ? undefined
    : requireSha256(record.activeManifestSha256);
  const activeRelativePath = record.activeRelativePath === undefined
    ? undefined
    : requireOwnedRelativePath(record.activeRelativePath);
  const sizeBytes = record.sizeBytes === undefined ? undefined : requireSize(record.sizeBytes, "sizeBytes");
  const hasActive = Boolean(activeVersion && activeManifestSha256 && activeRelativePath && sizeBytes !== undefined);
  if ((installState === "installed" || installState === "repair_needed") !== hasActive) {
    fail("settings.local_tool_record_invalid", "Lifecycle active fields do not match install state.");
  }
  if (!hasActive && enabled) fail("settings.local_tool_record_invalid", "Unavailable lifecycle targets cannot be enabled.");
  const relativePrefix = asset ? "assets/" : "installs/";
  if (activeRelativePath && !activeRelativePath.startsWith(relativePrefix)) {
    fail("settings.local_tool_record_invalid", "Lifecycle target path has the wrong ownership class.");
  }
  return {
    installState,
    enabled,
    ...(activeVersion ? { activeVersion } : {}),
    ...(activeManifestSha256 ? { activeManifestSha256 } : {}),
    ...(activeRelativePath ? { activeRelativePath } : {}),
    platform: requireEnum(record.platform, ["macos", "windows", "linux"] as const, "platform"),
    architecture: requireEnum(record.architecture, ["arm64", "x64"] as const, "architecture"),
    capabilities: requireUniqueStrings(record.capabilities, "capabilities", 64),
    license: parseLicense(record.license),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
    health: requireEnum(record.health, ["pass", "fail", "unknown"] as const, "health") as LocalToolHealthState
  };
}

function collectReferencedPaths(records: readonly LocalToolLifecycleRecord[]): Set<string> {
  const paths = new Set<string>();
  for (const record of records) {
    if (record.activeRelativePath) paths.add(record.activeRelativePath);
    for (const asset of record.assets) {
      if (asset.activeRelativePath) paths.add(asset.activeRelativePath);
    }
  }
  return paths;
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  let renamed = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    renamed = true;
    fsyncDirectoryIfSupported(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!renamed) fs.rmSync(temporaryPath, { force: true });
  }
}

function createOwnedDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new LocalToolLifecycleStoreError(
      "settings.local_tool_root_invalid",
      "Local-tool owned path must be a non-symlink directory."
    );
  }
}

function createOwnedSubdirectory(rootPath: string, directoryPath: string): void {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(directoryPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail("settings.local_tool_path_escape", "Local-tool directory escapes its owned root.");
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stats = fs.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool owned directories cannot traverse symbolic links.");
    }
  }
}

function assertOwnedSegmentsWithoutSymlink(rootPath: string, relativePath: string): void {
  const safePath = requireOwnedRelativePath(relativePath);
  let current = path.resolve(rootPath);
  for (const segment of safePath.split("/")) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return;
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool owned paths cannot traverse symbolic links.");
    }
  }
}

function assertOwnedParentSegmentsWithoutSymlink(rootPath: string, relativePath: string): void {
  const safePath = requireOwnedRelativePath(relativePath);
  const segments = safePath.split("/").slice(0, -1);
  let current = path.resolve(rootPath);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) return;
    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      fail("settings.local_tool_symlink_rejected", "Local-tool owned paths cannot traverse symbolic-link parents.");
    }
  }
}

function resolveOwnedRelativePath(rootPath: string, relativePath: string): string {
  const safePath = requireOwnedRelativePath(relativePath);
  const resolved = path.resolve(rootPath, ...safePath.split("/"));
  if (!resolved.startsWith(`${rootPath}${path.sep}`)) {
    fail("settings.local_tool_path_escape", "Local-tool path escapes its owned root.");
  }
  return resolved;
}

function requireOwnedRelativePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    fail("settings.local_tool_record_invalid", "Lifecycle relative path is invalid.");
  }
  if (value.includes("\\") || value.includes("\0") || value.includes("%") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    fail("settings.local_tool_path_escape", "Lifecycle path must be a canonical relative path.");
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("settings.local_tool_path_escape", "Lifecycle path contains an unsafe segment.");
  }
  if (path.posix.normalize(value) !== value) fail("settings.local_tool_path_escape", "Lifecycle path is not canonical.");
  return value;
}

function requireSafeRequestId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(value)) {
    fail("settings.local_tool_request_invalid", "Local-tool request identity is invalid.");
  }
  return value;
}

function requireSafeId(value: unknown, label: string): string {
  const id = requireString(value, label, 1, 80);
  if (!SAFE_ID_PATTERN.test(id)) fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  return id;
}

function requireSafeVersion(value: unknown): string {
  const version = requireString(value, "version", 1, 80);
  if (!SAFE_VERSION_PATTERN.test(version)) fail("settings.local_tool_record_invalid", "Lifecycle version is invalid.");
  return version;
}

function requireSafeLabel(value: string): string {
  const label = value.replaceAll(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  return label || "entry";
}

function requireSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("settings.local_tool_record_invalid", "Lifecycle checksum is invalid.");
  }
  return value;
}

function requireSize(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  }
  return value;
}

function requireIsoDate(value: unknown, label: string): string {
  const date = requireString(value, label, 1, 80);
  if (!Number.isFinite(Date.parse(date))) fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  return date;
}

function parseLicense(value: unknown): { readonly spdxId: string; readonly name?: string } {
  const record = requireObject(value, "license");
  assertExactKeys(record, ["spdxId", "name"], "license");
  const spdxId = requireString(record.spdxId, "license.spdxId", 1, 80);
  const name = record.name === undefined ? undefined : requireString(record.name, "license.name", 1, 160);
  return { spdxId, ...(name ? { name } : {}) };
}

function requireUniqueStrings(value: unknown, label: string, maximum: number): string[] {
  const values = requireArray(value, label, maximum).map((entry, index) => requireString(entry, `${label}[${index}]`, 1, 120));
  if (new Set(values).size !== values.length) fail("settings.local_tool_record_invalid", `${label} must be unique.`);
  return values;
}

function requireArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  return value;
}

function requireString(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  }
  return value;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("settings.local_tool_record_invalid", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const keys = new Set(allowed);
  if (Object.keys(record).some((key) => !keys.has(key))) {
    fail("settings.local_tool_record_invalid", `${label} contains an unsupported field.`);
  }
}

function requireEnum<const Values extends readonly string[]>(value: unknown, values: Values, label: string): Values[number] {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    fail("settings.local_tool_record_invalid", `${label} is invalid.`);
  }
  return value as Values[number];
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

function fail(code: string, message: string): never {
  throw new LocalToolLifecycleStoreError(code, message);
}
