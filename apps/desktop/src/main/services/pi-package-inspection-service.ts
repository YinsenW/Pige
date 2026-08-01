import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PiPackageInspectRequestSchema,
  PiPackageInspectResultSchema,
  type PiPackageCatalogEntry,
  type PiPackageInspectRequest,
  type PiPackageInspectResult,
  type PiPackageRegistrySummary,
  type PiPackageType
} from "@pige/schemas";
import { PiPackageCatalogService } from "./pi-package-catalog-service";
import {
  PiPackageManagerService,
  type PiPackageRecord
} from "./pi-package-manager-service";

const MAX_MANIFEST_BYTES = 512 * 1024;
const CATALOG_REQUEST_ID = "pi_package_catalog_request_installedinspection";

export class PiPackageInspectionService {
  readonly #manager: PiPackageManagerService;
  readonly #catalog: PiPackageCatalogService;
  readonly #summary: () => Promise<PiPackageRegistrySummary>;
  readonly #packageRoot: string;

  constructor(options: {
    readonly appDataRoot: string;
    readonly manager: PiPackageManagerService;
    readonly catalog: PiPackageCatalogService;
    readonly summary: () => Promise<PiPackageRegistrySummary>;
  }) {
    this.#manager = options.manager;
    this.#catalog = options.catalog;
    this.#summary = options.summary;
    const root = path.resolve(options.appDataRoot);
    if (!path.isAbsolute(root)) throw new Error("Pi package inspection root must be absolute.");
    this.#packageRoot = path.join(root, "pi-packages");
  }

  async inspect(requestInput: PiPackageInspectRequest): Promise<PiPackageInspectResult> {
    const request = PiPackageInspectRequestSchema.parse(requestInput);
    const identity = { apiVersion: 1 as const, requestId: request.requestId, packageId: request.packageId };
    try {
      const before = await this.#summary();
      if (before.revision !== request.expectedRegistryRevision) {
        return PiPackageInspectResultSchema.parse({ ...identity, status: "stale", registry: before });
      }
      const projected = before.packages.find((candidate) => candidate.packageId === request.packageId);
      if (!projected) {
        return PiPackageInspectResultSchema.parse({ ...identity, status: "not_found", registry: before });
      }
      const registry = this.#manager.readLifecycleRegistry();
      const record = registry.revision === before.revision
        ? registry.packages.find((candidate) => candidate.packageId === request.packageId)
        : undefined;
      if (!record || record.version !== projected.version) {
        const current = await this.#summary();
        return PiPackageInspectResultSchema.parse({ ...identity, status: "stale", registry: current });
      }

      this.#manager.lifecycleStore.assertInstalled(record);
      assertDescriptor(this.#installedPath(record), record);
      this.#manager.lifecycleStore.assertInstalled(record);

      const currentRegistry = this.#manager.readLifecycleRegistry();
      const currentRecord = currentRegistry.packages.find((candidate) => candidate.packageId === request.packageId);
      const after = await this.#summary();
      if (currentRegistry.revision !== registry.revision || !currentRecord || !sameRecord(currentRecord, record) ||
        after.revision !== before.revision) {
        return PiPackageInspectResultSchema.parse({ ...identity, status: "stale", registry: after });
      }
      const reviewed = this.#reviewedDisclosure(record);
      return PiPackageInspectResultSchema.parse({
        ...identity,
        status: "ready",
        registryRevision: after.revision,
        inspection: {
          packageId: record.packageId,
          packageName: record.packageName,
          version: record.version,
          integrity: record.integrity,
          installedAt: record.installedAt,
          state: record.enabled ? "installed_enabled" : "installed_disabled",
          packageTypes: record.packageTypes,
          dependencyCount: record.dependencyCount,
          enabled: record.enabled,
          pinned: record.pinned === true,
          source: "npm",
          installationTrust: "community",
          integrityStatus: "verified",
          catalogDisclosure: reviewed ? { status: "reviewed", entry: reviewed } : { status: "unknown" }
        }
      });
    } catch {
      return PiPackageInspectResultSchema.parse({ ...identity, status: "failed" });
    }
  }

  #installedPath(record: PiPackageRecord): string {
    const installed = path.resolve(this.#packageRoot, record.relativePath);
    const relative = path.relative(this.#packageRoot, installed);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Pi package inspection escaped managed storage.");
    }
    return installed;
  }

  #reviewedDisclosure(record: PiPackageRecord): PiPackageCatalogEntry | undefined {
    const result = this.#catalog.query({ apiVersion: 1, requestId: CATALOG_REQUEST_ID, query: "" });
    if (result.status !== "ready") return undefined;
    return result.entries.find((entry) => entry.packageName === record.packageName && entry.version === record.version &&
      entry.integrity === record.integrity && sameStrings(entry.packageTypes, record.packageTypes));
  }
}

function assertDescriptor(root: string, record: PiPackageRecord): void {
  const manifest = readManifest(path.join(root, "package.json"));
  if (manifest.name !== record.packageName || manifest.version !== record.version ||
    digestStableJson(manifestIdentity(manifest)) !== record.manifestHash ||
    !sameStrings(packageTypes(manifest.pi), record.packageTypes) || dependencyCount(manifest) !== record.dependencyCount) {
    throw new Error("Pi package descriptor changed.");
  }
  if (manifest.bin !== undefined || manifest.gypfile === true || manifest.binary !== undefined) {
    throw new Error("Pi package executable metadata changed.");
  }
  const scripts = objectOrUndefined(manifest.scripts);
  if (scripts && ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]
    .some((name) => Object.prototype.hasOwnProperty.call(scripts, name))) {
    throw new Error("Pi package install hooks changed.");
  }
  assertDeclaredEntries(root, manifest.pi);
}

function readManifest(filePath: string): Record<string, unknown> {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || stats.size < 1 || stats.size > MAX_MANIFEST_BYTES) {
      throw new Error("Pi package manifest is invalid.");
    }
    const value: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Pi package manifest is invalid.");
    return value as Record<string, unknown>;
  } finally { fs.closeSync(descriptor); }
}

function assertDeclaredEntries(root: string, pi: unknown): void {
  const declaration = objectOrUndefined(pi);
  if (!declaration) throw new Error("Pi package declaration is invalid.");
  for (const key of ["extensions", "skills", "prompts", "themes"]) {
    const entries = declaration[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 64) throw new Error("Pi package declaration is invalid.");
    for (const entry of entries) {
      if (typeof entry !== "string") throw new Error("Pi package declaration is invalid.");
      const relative = entry.startsWith("./") ? entry.slice(2) : entry;
      if (!relative || relative.includes("\\") || path.isAbsolute(relative) ||
        relative.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Pi package declaration is invalid.");
      }
      const target = path.resolve(root, relative);
      const confined = path.relative(root, target);
      const stats = fs.lstatSync(target);
      if (!confined || confined === ".." || confined.startsWith(`..${path.sep}`) || path.isAbsolute(confined) ||
        !stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
        throw new Error("Pi package declaration is invalid.");
      }
    }
  }
}

function packageTypes(value: unknown): readonly PiPackageType[] {
  const declaration = objectOrUndefined(value);
  if (!declaration) return [];
  const types: PiPackageType[] = [];
  if (Array.isArray(declaration.extensions) && declaration.extensions.length > 0) types.push("extension");
  if (Array.isArray(declaration.skills) && declaration.skills.length > 0) types.push("skill");
  if (Array.isArray(declaration.prompts) && declaration.prompts.length > 0) types.push("prompt");
  if (Array.isArray(declaration.themes) && declaration.themes.length > 0) types.push("theme");
  return types;
}

function dependencyCount(manifest: Record<string, unknown>): number {
  let count = 0;
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const value = manifest[key];
    if (value === undefined) continue;
    const entries = Object.entries(objectOrUndefined(value) ?? {});
    count += entries.length;
  }
  for (const key of ["bundledDependencies", "bundleDependencies"] as const) {
    const value = manifest[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) count += value.length;
    else if (value !== false) throw new Error("Pi package dependencies changed.");
  }
  return count;
}

function manifestIdentity(manifest: Record<string, unknown>): Record<string, unknown> {
  return { name: manifest.name, version: manifest.version, pi: manifest.pi ?? null, scripts: manifest.scripts ?? null,
    dependencies: manifest.dependencies ?? null, optionalDependencies: manifest.optionalDependencies ?? null,
    peerDependencies: manifest.peerDependencies ?? null, bundledDependencies: manifest.bundledDependencies ?? null,
    bundleDependencies: manifest.bundleDependencies ?? null };
}

function digestStableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Pi package metadata is invalid.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  throw new Error("Pi package metadata is invalid.");
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRecord(left: PiPackageRecord, right: PiPackageRecord): boolean {
  return stableJson(left) === stableJson(right);
}
