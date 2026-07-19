import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  PermissionCapabilitySchema,
  SkillManifestSchema,
  SkillRegistryFileSchema,
  SkillRegistryMutationResultSchema,
  SkillRegistryQueryResultSchema,
  SkillRegistrySummarySchema,
  type SkillCapability,
  type SkillDataBoundary,
  type SkillDisableRequest,
  type SkillManifest,
  type SkillRegistryFile,
  type SkillRegistryMutationResult,
  type SkillRegistryQueryResult,
  type SkillRegistryRecord,
  type SkillRegistrySummary,
  type SkillSummary
} from "@pige/schemas";
import { containsRestrictedModelContent } from "./model-egress-content";

const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_FRONTMATTER_BYTES = 32 * 1024;
const MAX_REGISTRY_LOCK_BYTES = 512;
const ACTIVE_SKILL_REGISTRY_LOCK_PATHS = new Set<string>();
const ARRAY_FIELDS = new Set(["capabilities", "triggers", "dataBoundary"]);
const MANIFEST_FIELDS = new Set([
  "id",
  "name",
  "version",
  "description",
  "scope",
  "kind",
  "capabilities",
  "triggers",
  "author",
  "sourceUrl",
  "license",
  "updatedAt",
  "dataBoundary",
  "permissionSummary"
]);
const DATA_BOUNDARY_ORDER: readonly SkillDataBoundary[] = [
  "local",
  "filesystem",
  "network",
  "cloud",
  "brokered_credential",
  "destructive"
];

export class SkillRegistryService {
  readonly #appDataRoot: string;
  readonly #rootPath: string;
  readonly #installedRoot: string;
  readonly #registryPath: string;
  readonly #registryLockPath: string;

  constructor(appDataRoot: string, options: { readonly recoverOrphanedMutationLock?: boolean } = {}) {
    if (!path.isAbsolute(appDataRoot)) {
      throw skillError("skill.registry_root_invalid", "Skill Registry requires an absolute app-data root.");
    }
    let canonicalRoot: string;
    try {
      fs.mkdirSync(appDataRoot, { recursive: true, mode: 0o700 });
      canonicalRoot = fs.realpathSync.native(appDataRoot);
      const rootStats = fs.lstatSync(canonicalRoot);
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
        throw skillError("skill.registry_root_invalid", "Skill Registry app-data root is unsafe.");
      }
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw skillError("skill.registry_root_invalid", "Skill Registry app-data root is unavailable.");
    }
    this.#appDataRoot = canonicalRoot;
    this.#rootPath = path.join(canonicalRoot, "skills");
    this.#installedRoot = path.join(this.#rootPath, "installed");
    this.#registryPath = path.join(this.#rootPath, "registry.json");
    this.#registryLockPath = path.join(this.#rootPath, ".registry.lock");
    if (options.recoverOrphanedMutationLock) {
      try {
        this.#recoverOrphanedMutationLock();
      } catch {
        // An unsafe lock blocks mutation but must not prevent the desktop from opening.
      }
    }
  }

  summary(): SkillRegistryQueryResult {
    try {
      return SkillRegistryQueryResultSchema.parse({ status: "ready", registry: this.#project(this.#readRegistry()) });
    } catch {
      return skillQueryFailed();
    }
  }

  disable(request: SkillDisableRequest): SkillRegistryMutationResult {
    let mutationLock: SkillRegistryMutationLock | undefined;
    try {
      this.#prepare();
      mutationLock = acquireSkillRegistryMutationLock(this.#registryLockPath);
      const current = this.#readRegistry();
      if (request.expectedRevision !== current.revision) {
        return SkillRegistryMutationResultSchema.parse({ status: "stale", registry: this.#project(current) });
      }
      const index = current.skills.findIndex((skill) => skill.id === request.skillId);
      if (index < 0) {
        return SkillRegistryMutationResultSchema.parse({ status: "not_found", registry: this.#project(current) });
      }
      const existing = current.skills[index]!;
      if (!existing.enabled) {
        return SkillRegistryMutationResultSchema.parse({ status: "committed", registry: this.#project(current) });
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        throw skillError("skill.registry_revision_exhausted", "Skill Registry revision is exhausted.");
      }
      const nextSkills = [...current.skills];
      nextSkills[index] = { ...existing, enabled: false, updatedAt: new Date().toISOString() };
      const next = SkillRegistryFileSchema.parse({
        schemaVersion: 1,
        revision: current.revision + 1,
        skills: nextSkills
      });
      mutationLock.assertOwned();
      this.#writeRegistry(next);
      return SkillRegistryMutationResultSchema.parse({ status: "committed", registry: this.#project(next) });
    } catch (caught) {
      return skillMutationFailed(isErrno(caught, "EEXIST") ? "busy" : "unavailable");
    } finally {
      mutationLock?.release();
    }
  }

  #recoverOrphanedMutationLock(): void {
    this.#prepare();
    let stats: fs.Stats | undefined;
    try {
      stats = fs.lstatSync(this.#registryLockPath);
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) {
        throw skillError("skill.registry_lock_invalid", "Skill Registry mutation lock is unavailable.");
      }
    }
    if (stats) {
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw skillError("skill.registry_lock_invalid", "Skill Registry mutation lock is unsafe.");
      }
      const recoveryPath = path.join(this.#rootPath, `.registry.lock.recovered.${randomUUID()}`);
      fs.renameSync(this.#registryLockPath, recoveryPath);
      fs.rmSync(recoveryPath, { force: true });
    }
    for (const entry of fs.readdirSync(this.#rootPath)) {
      if (!/^\.registry\.lock\.(?:released|recovered)\.[0-9a-f-]{36}$/iu.test(entry)) continue;
      const stalePath = path.join(this.#rootPath, entry);
      const staleStats = fs.lstatSync(stalePath);
      if (staleStats.isFile() && !staleStats.isSymbolicLink()) fs.rmSync(stalePath, { force: true });
    }
    fsyncDirectory(this.#rootPath);
  }

  #project(registry: SkillRegistryFile): SkillRegistrySummary {
    const skills: SkillSummary[] = [];
    let invalidManifestCount = 0;
    for (const record of registry.skills) {
      try {
        skills.push(this.#projectRecord(record));
      } catch {
        invalidManifestCount += 1;
      }
    }
    skills.sort((left, right) => left.id.localeCompare(right.id, "en"));
    return SkillRegistrySummarySchema.parse({
      apiVersion: 1,
      revision: registry.revision,
      invalidManifestCount,
      skills
    });
  }

  #projectRecord(record: SkillRegistryRecord): SkillSummary {
    if (record.trust !== "user_confirmed") {
      throw skillError("skill.registry_record_invalid", "Machine-local Skill trust provenance is invalid.");
    }
    const loaded = this.#readManifest(record.id);
    if (
      loaded.sha256 !== record.manifestSha256 ||
      loaded.manifest.id !== record.id ||
      loaded.manifest.version !== record.version ||
      loaded.manifest.scope !== "machine_local" ||
      loaded.manifest.kind === "package_provided"
    ) {
      throw skillError("skill.manifest_changed", "Installed Skill identity no longer matches its registry record.");
    }
    assertRendererSafeDisplayText(loaded.manifest.name);
    assertRendererSafeDisplayText(loaded.manifest.description);
    if (loaded.manifest.author) assertRendererSafeDisplayText(loaded.manifest.author);
    if (loaded.manifest.license) assertRendererSafeDisplayText(loaded.manifest.license);
    return {
      id: loaded.manifest.id,
      name: loaded.manifest.name,
      version: loaded.manifest.version,
      description: loaded.manifest.description,
      scope: loaded.manifest.scope,
      kind: loaded.manifest.kind,
      enabled: record.enabled,
      trust: record.trust,
      capabilities: loaded.manifest.capabilities,
      dataBoundaries: deriveDataBoundaries(loaded.manifest.capabilities),
      ...(loaded.manifest.author ? { author: loaded.manifest.author } : {}),
      ...(loaded.manifest.license ? { license: loaded.manifest.license } : {})
    };
  }

  #readRegistry(): SkillRegistryFile {
    this.#prepare();
    const body = readBoundedNoFollow(this.#registryPath, MAX_REGISTRY_BYTES);
    if (body === undefined) return { schemaVersion: 1, revision: 0, skills: [] };
    try {
      return SkillRegistryFileSchema.parse(JSON.parse(body));
    } catch {
      throw skillError("skill.registry_invalid", "Skill Registry state is unavailable or invalid.");
    }
  }

  #writeRegistry(registry: SkillRegistryFile): void {
    this.#prepare();
    const parsed = SkillRegistryFileSchema.parse(registry);
    const temporaryPath = path.join(
      this.#rootPath,
      `.registry.${process.pid}.${randomUUID()}.tmp`
    );
    let descriptor: number | undefined;
    let renamed = false;
    try {
      descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.#registryPath);
      renamed = true;
      fsyncDirectory(this.#rootPath);
      const reread = this.#readRegistry();
      if (JSON.stringify(reread) !== JSON.stringify(parsed)) {
        throw skillError("skill.registry_write_failed", "Skill Registry state failed exact readback.");
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (!renamed) fs.rmSync(temporaryPath, { force: true });
    }
  }

  #readManifest(skillId: string): { readonly manifest: SkillManifest; readonly sha256: string } {
    this.#prepare();
    const skillDirectory = path.join(this.#installedRoot, skillId);
    assertOwnedDirectory(this.#installedRoot, skillDirectory);
    const manifestPath = path.join(skillDirectory, "SKILL.md");
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(manifestPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const before = fs.fstatSync(descriptor);
      if (!before.isFile() || before.size <= 0 || before.size > MAX_MANIFEST_BYTES) {
        throw skillError("skill.manifest_invalid", "Installed Skill manifest is unsafe or oversized.");
      }
      const bytes = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      if (!sameFileIdentity(before, after)) {
        throw skillError("skill.manifest_changed", "Installed Skill manifest changed while being read.");
      }
      const source = bytes.toString("utf8");
      if (source.includes("\uFFFD")) {
        throw skillError("skill.manifest_invalid", "Installed Skill manifest is not valid UTF-8.");
      }
      return {
        manifest: parseSkillManifest(source),
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
      };
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw skillError("skill.manifest_invalid", "Installed Skill manifest is unavailable or invalid.");
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  #prepare(): void {
    const rootStats = fs.lstatSync(this.#appDataRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw skillError("skill.registry_root_invalid", "Skill Registry app-data root is unsafe.");
    }
    createOwnedDirectory(this.#rootPath);
    createOwnedDirectory(this.#installedRoot);
  }
}

export function parseSkillManifest(source: string): SkillManifest {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES || /[\u0000\uFFFD]/u.test(source)) {
    throw skillError("skill.manifest_invalid", "Skill manifest is unsafe or oversized.");
  }
  const normalized = source.replace(/^\uFEFF/u, "");
  const lines = normalized.split(/\r?\n/u);
  if (lines[0] !== "---") throw skillError("skill.manifest_invalid", "Skill manifest frontmatter is required.");
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex < 0) throw skillError("skill.manifest_invalid", "Skill manifest frontmatter is incomplete.");
  const frontmatter = lines.slice(1, closingIndex).join("\n");
  if (Buffer.byteLength(frontmatter, "utf8") > MAX_FRONTMATTER_BYTES) {
    throw skillError("skill.manifest_invalid", "Skill manifest frontmatter is oversized.");
  }
  if (lines.slice(closingIndex + 1).join("\n").trim().length === 0) {
    throw skillError("skill.manifest_invalid", "Skill instructions are required.");
  }

  const values: Record<string, unknown> = {};
  let index = 1;
  while (index < closingIndex) {
    const line = lines[index]!;
    if (line.trim().length === 0 || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    if (/^\s/u.test(line)) throw skillError("skill.manifest_invalid", "Unexpected nested Skill metadata.");
    const separator = line.indexOf(":");
    if (separator <= 0) throw skillError("skill.manifest_invalid", "Skill metadata entry is malformed.");
    const key = line.slice(0, separator).trim();
    if (!MANIFEST_FIELDS.has(key) || Object.hasOwn(values, key)) {
      throw skillError("skill.manifest_invalid", "Skill metadata contains an unknown or duplicate field.");
    }
    const rawValue = line.slice(separator + 1).trim();
    if (rawValue.length > 0) {
      values[key] = ARRAY_FIELDS.has(key) ? parseInlineArray(rawValue) : parseScalar(rawValue);
      index += 1;
      continue;
    }
    if (!ARRAY_FIELDS.has(key)) throw skillError("skill.manifest_invalid", "Skill metadata value is missing.");
    const entries: string[] = [];
    index += 1;
    while (index < closingIndex && /^\s/u.test(lines[index]!)) {
      const item = lines[index]!;
      const match = /^ {2}- (.+)$/u.exec(item);
      if (!match) throw skillError("skill.manifest_invalid", "Skill metadata list is malformed.");
      entries.push(String(parseScalar(match[1]!.trim())));
      index += 1;
    }
    values[key] = entries;
  }
  if (typeof values.version === "string" && /^\d+$/u.test(values.version)) {
    values.version = Number.parseInt(values.version, 10);
  }
  try {
    return SkillManifestSchema.parse(values);
  } catch {
    throw skillError("skill.manifest_invalid", "Skill metadata failed strict validation.");
  }
}

function parseInlineArray(value: string): readonly string[] {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    throw skillError("skill.manifest_invalid", "Skill metadata lists must use block or inline array syntax.");
  }
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const items: string[] = [];
  let token = "";
  let quote: "\"" | "'" | undefined;
  for (const character of inner) {
    if (quote) {
      token += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      token += character;
    } else if (character === ",") {
      items.push(String(parseScalar(token.trim())));
      token = "";
    } else {
      token += character;
    }
  }
  if (quote) throw skillError("skill.manifest_invalid", "Skill metadata contains an unterminated quote.");
  items.push(String(parseScalar(token.trim())));
  return items;
}

function parseScalar(value: string): string {
  if (value.length === 0 || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw skillError("skill.manifest_invalid", "Skill metadata scalar is invalid.");
  }
  if (value.startsWith("\"") || value.endsWith("\"")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("not a string");
      if (parsed.length === 0 || parsed.length > 2048 || /[\u0000-\u001f\u007f\uFFFD]/u.test(parsed)) {
        throw new Error("unsafe decoded string");
      }
      return parsed;
    } catch {
      throw skillError("skill.manifest_invalid", "Skill metadata quoted scalar is invalid.");
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'"))) {
      throw skillError("skill.manifest_invalid", "Skill metadata quoted scalar is invalid.");
    }
    return value.slice(1, -1).replace(/''/gu, "'");
  }
  if (/^[\[\]{}>|]/u.test(value) || /\s#|^[-?:,][\s\[]/u.test(value)) {
    throw skillError("skill.manifest_invalid", "Skill metadata uses unsupported YAML features.");
  }
  return value;
}

function deriveDataBoundaries(capabilities: readonly SkillCapability[]): SkillDataBoundary[] {
  const boundaries = new Set<SkillDataBoundary>();
  for (const capability of capabilities) {
    if (!PermissionCapabilitySchema.safeParse(capability).success) {
      boundaries.add("local");
      continue;
    }
    switch (capability) {
      case "read_vault":
      case "write_vault":
      case "change_settings":
      case "spawn_agent":
        boundaries.add("local");
        break;
      case "delete_vault":
      case "change_pige_schema":
        boundaries.add("destructive");
        break;
      case "external_filesystem":
      case "run_shell":
      case "install_local_tool":
        boundaries.add("filesystem");
        break;
      case "external_network":
        boundaries.add("network");
        break;
      case "install_package":
        boundaries.add("network");
        boundaries.add("filesystem");
        break;
      case "call_cloud_model_with_private_or_large_source":
        boundaries.add("cloud");
        break;
      case "use_brokered_credential":
        boundaries.add("brokered_credential");
        break;
    }
  }
  return DATA_BOUNDARY_ORDER.filter((boundary) => boundaries.has(boundary));
}

function readBoundedNoFollow(filePath: string, maximumBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maximumBytes) {
      throw skillError("skill.registry_invalid", "Skill Registry file is unsafe or oversized.");
    }
    return fs.readFileSync(descriptor, "utf8");
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    if (caught instanceof PigeDomainError) throw caught;
    throw skillError("skill.registry_invalid", "Skill Registry file is unavailable or invalid.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createOwnedDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw skillError("skill.registry_root_invalid", "Skill Registry owned directory is unsafe.");
  }
}

function assertOwnedDirectory(rootPath: string, directoryPath: string): void {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDirectory = path.resolve(directoryPath);
  if (!resolvedDirectory.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw skillError("skill.registry_path_escape", "Skill Registry path escapes its owned root.");
  }
  const stats = fs.lstatSync(resolvedDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw skillError("skill.manifest_invalid", "Installed Skill directory is unsafe.");
  }
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    const unsupported = ["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"];
    if (!unsupported.some((code) => isErrno(caught, code))) {
      throw caught;
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isErrno(caught: unknown, code: string): boolean {
  return Boolean(caught && typeof caught === "object" && "code" in caught && caught.code === code);
}

function assertRendererSafeDisplayText(value: string): void {
  const withoutPublicUrls = value.replace(/https?:\/\/[^\s<>"'`),;\]}]+/giu, "[url]");
  const containsPathSyntax = /(?:^|[\s"'`([{=,:;])(?:file:\/\/|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/]|\\\\|\\[^\\\s]+|\/[^/\s]+)/iu.test(withoutPublicUrls);
  if (containsPathSyntax || containsRestrictedModelContent(value)) {
    throw skillError("skill.manifest_display_unsafe", "Installed Skill display metadata is unsafe.");
  }
}

function skillErrorSummary(reason: "busy" | "unavailable") {
  return {
    code: reason === "busy" ? "skill.registry_busy" : "skill.registry_unavailable",
    domain: "skill",
    messageKey: "error.generic",
    retryable: true,
    severity: "error",
    userAction: "retry"
  } as const;
}

function skillQueryFailed(): SkillRegistryQueryResult {
  return SkillRegistryQueryResultSchema.parse({ status: "failed", error: skillErrorSummary("unavailable") });
}

function skillMutationFailed(reason: "busy" | "unavailable"): SkillRegistryMutationResult {
  return SkillRegistryMutationResultSchema.parse({ status: "failed", error: skillErrorSummary(reason) });
}

interface SkillRegistryLockRecord {
  readonly schemaVersion: 1;
  readonly ownerId: string;
  readonly pid: number;
}

interface SkillRegistryMutationLock {
  readonly assertOwned: () => void;
  readonly release: () => void;
}

export function acquireSkillRegistryMutationLock(lockPath: string): SkillRegistryMutationLock {
  if (ACTIVE_SKILL_REGISTRY_LOCK_PATHS.has(lockPath)) {
    const busy = new Error("Skill Registry mutation lock is already active.") as NodeJS.ErrnoException;
    busy.code = "EEXIST";
    throw busy;
  }
  recoverAbandonedCurrentProcessLock(lockPath);
  const ownerId = randomUUID();
  const record: SkillRegistryLockRecord = { schemaVersion: 1, ownerId, pid: process.pid };
  let descriptor: number | undefined;
  let identity: fs.Stats;
  try {
    descriptor = fs.openSync(
      lockPath,
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    identity = fs.fstatSync(descriptor);
    ACTIVE_SKILL_REGISTRY_LOCK_PATHS.add(lockPath);
  } catch (caught) {
    if (descriptor !== undefined) {
      removeExactLockPath(lockPath, descriptor);
      fs.closeSync(descriptor);
    }
    throw caught;
  }
  let released = false;
  const assertOwned = (): void => {
    if (released || descriptor === undefined) {
      throw skillError("skill.registry_lock_lost", "Skill Registry mutation lock was lost.");
    }
    const held = fs.fstatSync(descriptor);
    let current: fs.Stats;
    try {
      current = fs.lstatSync(lockPath);
    } catch {
      throw skillError("skill.registry_lock_lost", "Skill Registry mutation lock was lost.");
    }
    if (current.isSymbolicLink() || !current.isFile() || !sameFileIdentity(held, identity) || !sameFileIdentity(current, identity)) {
      throw skillError("skill.registry_lock_lost", "Skill Registry mutation lock was replaced.");
    }
    const parsed = parseSkillRegistryLock(readBoundedNoFollow(lockPath, MAX_REGISTRY_LOCK_BYTES) ?? "");
    if (parsed.ownerId !== ownerId || parsed.pid !== process.pid) {
      throw skillError("skill.registry_lock_lost", "Skill Registry mutation lock ownership changed.");
    }
  };
  return {
    assertOwned,
    release: () => {
      if (released) return;
      let releasedPath: string | undefined;
      try {
        assertOwned();
        releasedPath = `${lockPath}.released.${ownerId}`;
        fs.renameSync(lockPath, releasedPath);
        fsyncDirectory(path.dirname(lockPath));
      } catch {
        // Never remove a path that no longer names this exact owner and inode.
      } finally {
        released = true;
        ACTIVE_SKILL_REGISTRY_LOCK_PATHS.delete(lockPath);
        if (descriptor !== undefined) fs.closeSync(descriptor);
        descriptor = undefined;
        if (releasedPath) {
          try {
            fs.rmSync(releasedPath, { force: true });
          } catch {
            // The fixed lock name is already free; startup removes a leftover tombstone.
          }
        }
      }
    }
  };
}

function recoverAbandonedCurrentProcessLock(lockPath: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(lockPath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return;
    throw caught;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return;
  let record: SkillRegistryLockRecord;
  try {
    record = parseSkillRegistryLock(readBoundedNoFollow(lockPath, MAX_REGISTRY_LOCK_BYTES) ?? "");
  } catch {
    return;
  }
  const verified = fs.lstatSync(lockPath);
  if (record.pid !== process.pid || !sameFileIdentity(stats, verified)) return;
  const abandonedPath = `${lockPath}.released.${record.ownerId}`;
  fs.renameSync(lockPath, abandonedPath);
  try {
    fs.rmSync(abandonedPath, { force: true });
  } catch {
    // The fixed lock name is free; startup can remove the tombstone.
  }
}

function removeExactLockPath(lockPath: string, descriptor: number): void {
  try {
    const held = fs.fstatSync(descriptor);
    const current = fs.lstatSync(lockPath);
    if (current.isFile() && !current.isSymbolicLink() && sameFileIdentity(held, current)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // A failed acquisition must never remove a different path occupant.
  }
}

function parseSkillRegistryLock(source: string): SkillRegistryLockRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw skillError("skill.registry_lock_invalid", "Skill Registry mutation lock is invalid.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Object.keys(parsed).length !== 3 ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (parsed as { ownerId?: unknown }).ownerId !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test((parsed as { ownerId: string }).ownerId) ||
    !Number.isSafeInteger((parsed as { pid?: unknown }).pid) ||
    Number((parsed as { pid: number }).pid) <= 0
  ) {
    throw skillError("skill.registry_lock_invalid", "Skill Registry mutation lock is invalid.");
  }
  return parsed as SkillRegistryLockRecord;
}

function skillError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}
