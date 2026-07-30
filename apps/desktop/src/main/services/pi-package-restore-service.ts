import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PiPackageRegistrySummarySchema,
  PiPackageRestoreRequestSchema,
  PiPackageRestoreResultSchema,
  PiPackageUninstallResultSchema,
  type PiPackageRegistrySummary,
  type PiPackageRestorableSummary,
  type PiPackageRestoreRequest,
  type PiPackageRestoreResult,
  type PiPackageUninstallRequest,
  type PiPackageUninstallResult
} from "@pige/schemas";
import {
  PiPackageManagerService,
  type PiPackageRecord,
  type PiPackageRegistryFile
} from "./pi-package-manager-service";
import {
  hashPiPackageTree,
  hashPiPackageUninstallReceipt,
  type PiPackageRestoreReceipt,
  type PiPackageUninstallReceipt
} from "./pi-package-lifecycle-store";

const MAX_MANIFEST_BYTES = 512 * 1024;

interface RestoreCandidate {
  readonly receipt: PiPackageUninstallReceipt<PiPackageRecord>;
  readonly projection: PiPackageRestorableSummary;
}

export class PiPackageRestoreService {
  readonly #manager: PiPackageManagerService;
  readonly #now: () => Date;
  readonly #recovery: Promise<void>;

  constructor(options: { readonly manager: PiPackageManagerService; readonly now?: () => Date }) {
    this.#manager = options.manager;
    this.#now = options.now ?? (() => new Date());
    this.#recovery = this.#manager.withLifecycleLock(() => this.#recoverPending());
  }

  async summary(): Promise<PiPackageRegistrySummary> {
    await this.#recovery;
    return this.#project(this.#manager.readLifecycleRegistry());
  }

  async uninstall(request: PiPackageUninstallRequest): Promise<PiPackageUninstallResult> {
    await this.#recovery;
    const result = this.#manager.uninstall(request);
    if (!("registry" in result)) return result;
    const current = this.#manager.readLifecycleRegistry();
    return current.revision === result.registry.revision
      ? PiPackageUninstallResultSchema.parse({ ...result, registry: this.#project(current) })
      : result;
  }

  async restore(requestInput: PiPackageRestoreRequest): Promise<PiPackageRestoreResult> {
    const request = PiPackageRestoreRequestSchema.parse(requestInput);
    const identity = restoreIdentity(request);
    try {
      await this.#recovery;
      return await this.#manager.withLifecycleLock(() => {
        let current = this.#manager.readLifecycleRegistry();
        const replay = this.#manager.lifecycleStore.listRestoreReceipts()
          .find((receipt) => receipt.requestId === request.requestId);
        if (replay) return this.#replay(request, replay, current);
        if (current.revision !== request.expectedRegistryRevision) {
          return restoreResult(identity, "stale", this.#project(current));
        }
        if (current.packages.some((record) => record.packageId === request.packageId)) {
          return restoreResult(identity, "ineligible", this.#project(current));
        }
        const candidates = this.#candidates(current).filter(({ projection }) =>
          projection.restoreContextId === request.restoreContextId &&
          projection.packageId === request.packageId && projection.version === request.version &&
          projection.integrity === request.integrity && projection.pinned === request.pinned &&
          stableJson(projection.rollbackTarget) === stableJson(request.rollbackTarget)
        );
        if (candidates.length !== 1) return restoreResult(identity, "not_found", this.#project(current));
        const candidate = candidates[0]!;
        const receipt = this.#manager.lifecycleStore.prepareRestore({
          requestId: request.requestId,
          restoreContextId: request.restoreContextId,
          expectedRegistryRevision: current.revision,
          uninstallReceipt: candidate.receipt,
          createdAt: this.#now().toISOString()
        });
        this.#manager.lifecycleStore.ensureRestored(receipt);
        const next = this.#manager.restoreLifecycleRecord(current.revision, receipt.record);
        this.#manager.lifecycleStore.markRestoreCommitted(receipt, next.revision);
        current = next;
        return restoreResult(identity, "committed", this.#project(current));
      });
    } catch {
      return restoreResult(identity, "failed");
    }
  }

  #replay(
    request: PiPackageRestoreRequest,
    replay: PiPackageRestoreReceipt<PiPackageRecord>,
    current: PiPackageRegistryFile
  ): PiPackageRestoreResult {
    const identity = restoreIdentity(request);
    const uninstall = this.#manager.lifecycleStore.readUninstallReceipt(replay.uninstallRequestId);
    const rollbackTarget = uninstall
      ? this.#manager.lifecycleStore.rollbackTargetForRestore(uninstall.record) ?? null
      : null;
    const installed = current.packages.find((record) => record.packageId === request.packageId);
    if (uninstall && replay.state === "committed" && replay.committedRegistryRevision === current.revision &&
      installed && sameRecord(installed, replay.record) &&
      matchesRestoreRequest(request, replay, uninstall, rollbackTarget)) {
      return restoreResult(identity, "committed", this.#project(current));
    }
    return restoreResult(identity, "ineligible", this.#project(current));
  }

  #project(registry: PiPackageRegistryFile): PiPackageRegistrySummary {
    const base = this.#manager.projectLifecycleRegistry(registry);
    const restorablePackages = this.#candidates(registry).map(({ projection }) => projection);
    return PiPackageRegistrySummarySchema.parse({
      ...base,
      ...(restorablePackages.length > 0 ? { restorablePackages } : {})
    });
  }

  #candidates(registry: PiPackageRegistryFile): readonly RestoreCandidate[] {
    const installed = new Set(registry.packages.map((record) => record.packageId));
    const candidates: RestoreCandidate[] = [];
    for (const receipt of this.#manager.lifecycleStore.listUninstallReceipts()) {
      if (receipt.state !== "committed" || installed.has(receipt.packageId)) continue;
      try {
        const trashedPath = this.#manager.lifecycleStore.assertRestorable(receipt);
        assertRestorableDescriptor(trashedPath, receipt.record);
        const rollbackTarget = this.#manager.lifecycleStore.rollbackTargetForRestore(receipt.record) ?? null;
        candidates.push({
          receipt,
          projection: {
            restoreContextId: packageRestoreContextId(receipt, rollbackTarget),
            packageId: receipt.record.packageId,
            packageName: receipt.record.packageName,
            version: receipt.record.version,
            integrity: receipt.record.integrity,
            packageTypes: receipt.record.packageTypes,
            dependencyCount: receipt.record.dependencyCount,
            pinned: receipt.record.pinned === true,
            rollbackTarget,
            uninstalledAt: receipt.createdAt,
            canRestore: true
          }
        });
      } catch { /* Invalid private trash grants no renderer-visible restore authority. */ }
    }
    return candidates.sort((left, right) =>
      right.projection.uninstalledAt.localeCompare(left.projection.uninstalledAt) ||
      left.projection.restoreContextId.localeCompare(right.projection.restoreContextId, "en")
    );
  }

  #recoverPending(): void {
    for (const receipt of this.#manager.lifecycleStore.listRestoreReceipts()
      .filter((candidate) => candidate.state === "prepared")) {
      const current = this.#manager.readLifecycleRegistry();
      const installed = current.packages.find((record) => record.packageId === receipt.packageId);
      if (current.revision === receipt.expectedRegistryRevision && !installed) {
        this.#manager.lifecycleStore.ensureRestored(receipt);
        const next = this.#manager.restoreLifecycleRecord(current.revision, receipt.record);
        this.#manager.lifecycleStore.markRestoreCommitted(receipt, next.revision);
      } else if (current.revision === receipt.expectedRegistryRevision + 1 &&
        installed && sameRecord(installed, receipt.record)) {
        this.#manager.lifecycleStore.ensureRestored(receipt);
        this.#manager.lifecycleStore.markRestoreCommitted(receipt, current.revision);
      } else {
        throw new Error("package.restore_recovery_conflict");
      }
    }
  }
}

function assertRestorableDescriptor(root: string, record: PiPackageRecord): void {
  const manifest = readManifest(path.join(root, "package.json"));
  if (manifest.name !== record.packageName || manifest.version !== record.version ||
    digestStableJson(manifestIdentity(manifest)) !== record.manifestHash ||
    stableJson(packageTypes(manifest.pi)) !== stableJson(record.packageTypes) ||
    dependencyCount(manifest) !== record.dependencyCount || hashPiPackageTree(root) !== record.treeHash) {
    throw new Error("package.restore_descriptor_changed");
  }
  if (manifest.bin !== undefined || manifest.gypfile === true || manifest.binary !== undefined) {
    throw new Error("package.restore_executable_metadata");
  }
  const scripts = objectOrUndefined(manifest.scripts);
  if (scripts && ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"]
    .some((name) => Object.prototype.hasOwnProperty.call(scripts, name))) {
    throw new Error("package.restore_install_hook");
  }
  assertDeclaredEntries(root, manifest.pi);
}

function readManifest(filePath: string): Record<string, unknown> {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > MAX_MANIFEST_BYTES) {
      throw new Error("package.restore_manifest_invalid");
    }
    const value: unknown = JSON.parse(fs.readFileSync(descriptor, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("package.restore_manifest_invalid");
    return value as Record<string, unknown>;
  } finally { fs.closeSync(descriptor); }
}

function assertDeclaredEntries(root: string, pi: unknown): void {
  const declaration = objectOrUndefined(pi);
  if (!declaration) throw new Error("package.restore_manifest_invalid");
  for (const key of ["extensions", "skills", "prompts", "themes"]) {
    const entries = declaration[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 64) throw new Error("package.restore_manifest_invalid");
    for (const entry of entries) {
      if (typeof entry !== "string") throw new Error("package.restore_manifest_invalid");
      const relative = entry.startsWith("./") ? entry.slice(2) : entry;
      if (!relative || relative.includes("\\") || path.isAbsolute(relative) ||
        relative.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("package.restore_manifest_invalid");
      }
      const target = path.resolve(root, relative);
      if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("package.restore_manifest_invalid");
      const stats = fs.lstatSync(target);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw new Error("package.restore_manifest_invalid");
    }
  }
}

function dependencyCount(manifest: Record<string, unknown>): number {
  let count = 0;
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const value = objectOrUndefined(manifest[key]);
    if (manifest[key] !== undefined && !value) throw new Error("package.restore_dependencies_invalid");
    count += value ? Object.keys(value).length : 0;
  }
  for (const key of ["bundledDependencies", "bundleDependencies"]) {
    const value = manifest[key];
    if (value !== undefined && !Array.isArray(value)) throw new Error("package.restore_dependencies_invalid");
    count += Array.isArray(value) ? value.length : 0;
  }
  return count;
}

function packageTypes(pi: unknown): readonly string[] {
  const declaration = objectOrUndefined(pi);
  if (!declaration) return [];
  const output: string[] = [];
  if (Array.isArray(declaration.extensions) && declaration.extensions.length > 0) output.push("extension");
  if (Array.isArray(declaration.skills) && declaration.skills.length > 0) output.push("skill");
  if (Array.isArray(declaration.prompts) && declaration.prompts.length > 0) output.push("prompt");
  if (Array.isArray(declaration.themes) && declaration.themes.length > 0) output.push("theme");
  return output;
}

function manifestIdentity(manifest: Record<string, unknown>): Record<string, unknown> {
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

function packageRestoreContextId(
  receipt: PiPackageUninstallReceipt<PiPackageRecord>,
  rollbackTarget: { readonly rollbackId: string; readonly targetVersion: string } | null
): string {
  return `pi_package_restore_context_v1_${createHash("sha256")
    .update("pige.package.restore.context.v1\0", "utf8")
    .update(hashPiPackageUninstallReceipt(receipt), "utf8").update("\0", "utf8")
    .update(stableJson(rollbackTarget), "utf8").digest("hex").slice(0, 48)}`;
}

function matchesRestoreRequest(
  request: PiPackageRestoreRequest,
  receipt: PiPackageRestoreReceipt<PiPackageRecord>,
  uninstall: PiPackageUninstallReceipt<PiPackageRecord>,
  rollbackTarget: { readonly rollbackId: string; readonly targetVersion: string } | null
): boolean {
  return receipt.requestId === request.requestId && receipt.restoreContextId === request.restoreContextId &&
    receipt.packageId === request.packageId && receipt.expectedRegistryRevision === request.expectedRegistryRevision &&
    hashPiPackageUninstallReceipt(uninstall) === receipt.uninstallReceiptHash &&
    request.restoreContextId === packageRestoreContextId(uninstall, rollbackTarget) &&
    uninstall.record.version === request.version && uninstall.record.integrity === request.integrity &&
    (uninstall.record.pinned === true) === request.pinned && stableJson(rollbackTarget) === stableJson(request.rollbackTarget);
}

function restoreIdentity(request: PiPackageRestoreRequest) {
  const { expectedRegistryRevision: _expectedRegistryRevision, ...identity } = request;
  return identity;
}

function restoreResult(
  identity: ReturnType<typeof restoreIdentity>,
  status: "committed" | "stale" | "not_found" | "ineligible" | "failed",
  registry?: PiPackageRegistrySummary
): PiPackageRestoreResult {
  return PiPackageRestoreResultSchema.parse({ ...identity, status, ...(registry ? { registry } : {}) });
}

function sameRecord(left: PiPackageRecord, right: PiPackageRecord): boolean {
  return stableJson(left) === stableJson(right);
}

function digestStableJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  throw new Error("package.restore_identity_invalid");
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
