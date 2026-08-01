import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type { VaultSummary } from "@pige/contracts";
import {
  RootBindingIdSchema,
  VaultBindingsFileSchema,
  type ExternalManagedCopyRootBinding,
  type ManagedCopyRootSummary,
  type SourceRecord,
  type VaultBindingsFile
} from "@pige/schemas";
import { repairManagedCopyDependency } from "./backup-managed-copy-binding";

const EMPTY_BINDINGS: VaultBindingsFile = VaultBindingsFileSchema.parse({ schemaVersion: 1, roots: [], defaults: [] });

export interface ManagedCopyRootReceipt {
  readonly vaultId: string;
  readonly rootId: string;
  readonly revision: `sha256:${string}`;
}

export interface ManagedCopyRootSelection {
  readonly rootId: string;
  readonly rootPath: string;
  readonly pathBasis: "root_relative";
  readonly revision: `sha256:${string}`;
}

export interface ManagedCopyRootLease extends ManagedCopyRootSelection {
  assertCurrent(): void;
  release(): void;
}

export interface CaptureManagedCopyRoot {
  readonly rootId: string;
  readonly rootPath: string;
  readonly pathBasis: "vault_relative" | "root_relative";
}

export function selectCaptureManagedCopyRoot(
  owner: ManagedCopyRootService | undefined,
  vault: VaultSummary,
  vaultPath: string
): CaptureManagedCopyRoot {
  return (vault.sourceAssetRootKind === "external_binding" ? owner?.selection(vault.vaultId) : undefined) ?? {
    rootId: "root_vault_managed",
    rootPath: path.resolve(vaultPath),
    pathBasis: "vault_relative"
  };
}

export class ManagedCopyRootService {
  readonly #userDataPath: string;
  readonly #bindingsPath: string;

  constructor(userDataPathInput: string) {
    this.#userDataPath = canonicalDirectory(userDataPathInput, "managed_copy.root_registry_invalid");
    this.#bindingsPath = path.join(this.#userDataPath, "vault-bindings.json");
  }

  selection(vaultId: string): ManagedCopyRootSelection | undefined {
    const bindings = this.readBindings();
    const selected = bindings.defaults.find((entry) => entry.vaultId === vaultId);
    if (!selected) return undefined;
    const binding = bindings.roots.find((entry) => entry.vaultId === vaultId && entry.rootId === selected.rootId);
    if (!binding || binding.availability !== "available") return undefined;
    const rootPath = canonicalDirectory(binding.absolutePath, "managed_copy.root_unavailable");
    return {
      rootId: binding.rootId,
      rootPath,
      pathBasis: "root_relative",
      revision: bindingRevision(bindings, binding)
    };
  }

  summary(vaultId: string, mode: "inside_vault" | "external_binding"): ManagedCopyRootSummary {
    const bindings = this.readBindings();
    const selected = this.#selectionFrom(bindings, vaultId);
    const availability = mode === "inside_vault"
      ? "available"
      : selected && this.binding(vaultId, selected.rootId)
        ? "available"
        : "missing";
    return {
      activeVaultId: vaultId,
      sourceStorageRevision: sourceStorageRevision(vaultId, mode, bindings),
      mode,
      availability,
      canConfigure: true
    };
  }

  reconnectDefault(input: {
    readonly vaultPath: string;
    readonly vaultId: string;
    readonly selectedDirectory: string;
    readonly expectedSourceStorageRevision: string;
  }): ManagedCopyRootReceipt {
    const current = this.readBindings();
    if (sourceStorageRevision(input.vaultId, "external_binding", current) !== input.expectedSourceStorageRevision) {
      throw new PigeDomainError("managed_copy.selection_stale", "The managed-copy root selection changed.");
    }
    const rootId = current.defaults.find((entry) => entry.vaultId === input.vaultId)?.rootId;
    if (!rootId) throw new PigeDomainError("managed_copy.selection_missing", "The managed-copy root selection is unavailable.");
    try {
      repairManagedCopyDependency(
        this.#userDataPath,
        input.vaultPath,
        input.vaultId,
        { dependencyKind: "vault_binding", dependencyId: rootId },
        input.selectedDirectory
      );
    } catch (caught) {
      if (!(caught instanceof PigeDomainError) || caught.code !== "backup.reconnect_not_found") throw caught;
      this.repairBinding(input.vaultId, rootId, input.selectedDirectory);
    }
    const rebound = this.binding(input.vaultId, rootId);
    if (!rebound) throw new PigeDomainError("managed_copy.selection_failed", "The managed-copy root failed durable readback.");
    return { vaultId: input.vaultId, rootId, revision: rebound.revision };
  }

  bindDefault(input: {
    readonly vaultId: string;
    readonly selectedDirectory: string;
    readonly expectedRevision?: string;
  }): ManagedCopyRootReceipt {
    const rootPath = canonicalDirectory(input.selectedDirectory, "managed_copy.selection_invalid");
    const current = this.readBindings();
    const currentSelection = this.#selectionFrom(current, input.vaultId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentSelection?.revision) {
      throw new PigeDomainError("managed_copy.selection_stale", "The managed-copy root selection changed.");
    }
    const existing = current.roots.find((entry) => entry.vaultId === input.vaultId && entry.absolutePath === rootPath);
    const rootId = existing?.rootId ?? RootBindingIdSchema.parse(`root_${randomUUID().replaceAll("-", "")}`);
    const now = new Date().toISOString();
    const binding: ExternalManagedCopyRootBinding = {
      ...(existing ?? {}),
      rootId,
      vaultId: input.vaultId,
      purpose: "managed_copy",
      absolutePath: rootPath,
      availability: "available",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const next = VaultBindingsFileSchema.parse({
      ...current,
      roots: [...current.roots.filter((entry) => entry.rootId !== rootId), binding]
        .sort((left, right) => left.rootId.localeCompare(right.rootId)),
      defaults: [...current.defaults.filter((entry) => entry.vaultId !== input.vaultId), { vaultId: input.vaultId, rootId }]
        .sort((left, right) => left.vaultId.localeCompare(right.vaultId))
    });
    assertDistinctPaths(next.roots);
    this.#writeBindings(next);
    const reread = this.selection(input.vaultId);
    if (!reread || reread.rootId !== rootId || reread.rootPath !== rootPath) {
      throw new PigeDomainError("managed_copy.selection_failed", "The managed-copy root failed durable readback.");
    }
    return { vaultId: input.vaultId, rootId, revision: reread.revision };
  }

  repairBinding(vaultId: string, rootIdInput: string, selectedDirectory: string): ManagedCopyRootReceipt {
    const rootId = RootBindingIdSchema.parse(rootIdInput);
    const rootPath = canonicalDirectory(selectedDirectory, "backup.reconnect_selection_invalid");
    const current = this.readBindings();
    const existing = current.roots.find((entry) => entry.rootId === rootId);
    if (existing && existing.vaultId !== vaultId) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The stable root belongs to another vault.");
    }
    const now = new Date().toISOString();
    const binding: ExternalManagedCopyRootBinding = {
      ...(existing ?? {}), rootId, vaultId, purpose: "managed_copy", absolutePath: rootPath,
      availability: "available", createdAt: existing?.createdAt ?? now, updatedAt: now
    };
    const next = VaultBindingsFileSchema.parse({
      ...current,
      roots: [...current.roots.filter((entry) => entry.rootId !== rootId), binding]
        .sort((left, right) => left.rootId.localeCompare(right.rootId))
    });
    assertDistinctPaths(next.roots);
    this.#writeBindings(next);
    const reread = this.binding(vaultId, rootId);
    if (!reread || reread.rootPath !== rootPath) {
      throw new PigeDomainError("backup.reconnect_failed", "The repaired root failed exact readback.");
    }
    return { vaultId, rootId, revision: reread.revision };
  }

  binding(vaultId: string, rootIdInput: string): ManagedCopyRootSelection | undefined {
    const rootId = RootBindingIdSchema.parse(rootIdInput);
    const bindings = this.readBindings();
    const binding = bindings.roots.find((entry) =>
      entry.vaultId === vaultId && entry.rootId === rootId && entry.availability === "available"
    );
    if (!binding) return undefined;
    try {
      return {
        rootId,
        rootPath: canonicalDirectory(binding.absolutePath, "managed_copy.root_unavailable"),
        pathBasis: "root_relative",
        revision: bindingRevision(bindings, binding)
      };
    } catch {
      return undefined;
    }
  }

  acquire(vaultId: string, rootId: string): ManagedCopyRootLease {
    const selected = this.binding(vaultId, rootId);
    if (!selected) throw new PigeDomainError("source.managed_unavailable", "The managed-copy root is unavailable.");
    let released = false;
    return {
      ...selected,
      assertCurrent: () => {
        if (released) throw new PigeDomainError("source.managed_unavailable", "The managed-copy root lease was released.");
        const current = this.binding(vaultId, rootId);
        if (!current || current.revision !== selected.revision || current.rootPath !== selected.rootPath) {
          throw new PigeDomainError("source.managed_root_changed", "The managed-copy root binding changed.");
        }
      },
      release: () => { released = true; }
    };
  }

  resolveManagedCopy(vaultId: string, vaultPath: string, managedCopy: NonNullable<SourceRecord["managedCopy"]>): {
    readonly absolutePath: string;
    readonly containmentRoot: string;
    readonly assertCurrent: () => void;
    readonly release: () => void;
  } {
    if (!managedCopy.rootId || managedCopy.rootId === "root_vault_managed") {
      const root = path.resolve(vaultPath);
      return {
        absolutePath: confinedPath(root, managedCopy.path), containmentRoot: root,
        assertCurrent: () => undefined, release: () => undefined
      };
    }
    if (managedCopy.pathBasis !== "root_relative") {
      throw new PigeDomainError("source.managed_locator_invalid", "The external managed-copy locator is invalid.");
    }
    const lease = this.acquire(vaultId, managedCopy.rootId);
    return {
      absolutePath: confinedPath(lease.rootPath, managedCopy.path), containmentRoot: lease.rootPath,
      assertCurrent: lease.assertCurrent, release: lease.release
    };
  }

  readBindings(): VaultBindingsFile {
    if (!fs.existsSync(this.#bindingsPath)) return EMPTY_BINDINGS;
    const descriptor = fs.openSync(this.#bindingsPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const before = fs.fstatSync(descriptor);
      const atPath = fs.lstatSync(this.#bindingsPath);
      if (!before.isFile() || atPath.isSymbolicLink() || before.nlink !== 1 || !sameRevision(before, atPath)) {
        throw new PigeDomainError("managed_copy.root_registry_invalid", "The managed-copy root registry is unsafe.");
      }
      const bytes = fs.readFileSync(descriptor);
      if (bytes.byteLength > 4 * 1024 * 1024 || !sameRevision(before, fs.fstatSync(descriptor))) {
        throw new PigeDomainError("managed_copy.root_registry_invalid", "The managed-copy root registry changed.");
      }
      const parsed = VaultBindingsFileSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
      assertDistinctPaths(parsed.roots);
      return parsed;
    } finally {
      fs.closeSync(descriptor);
    }
  }

  #selectionFrom(bindings: VaultBindingsFile, vaultId: string): ManagedCopyRootSelection | undefined {
    const selected = bindings.defaults.find((entry) => entry.vaultId === vaultId);
    const binding = selected && bindings.roots.find((entry) => entry.rootId === selected.rootId && entry.vaultId === vaultId);
    if (!binding || binding.availability !== "available") return undefined;
    return { rootId: binding.rootId, rootPath: binding.absolutePath, pathBasis: "root_relative", revision: bindingRevision(bindings, binding) };
  }

  #writeBindings(bindings: VaultBindingsFile): void {
    const temporaryPath = path.join(this.#userDataPath, `.vault-bindings.${process.pid}.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(temporaryPath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(bindings, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.#bindingsPath);
      const directory = fs.openSync(this.#userDataPath, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporaryPath, { force: true });
    }
  }
}

function canonicalDirectory(input: string, code: string): string {
  try {
    const resolved = path.resolve(input);
    const identity = fs.lstatSync(resolved);
    if (!identity.isDirectory() || identity.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved) throw new Error();
    return resolved;
  } catch {
    throw new PigeDomainError(code, "The managed-copy root directory is unavailable or unsafe.");
  }
}

function confinedPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new PigeDomainError("source.managed_locator_invalid", "The managed-copy locator is invalid.");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new PigeDomainError("source.managed_locator_invalid", "The managed-copy locator is invalid.");
  }
  const candidate = path.resolve(root, ...segments);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PigeDomainError("source.managed_locator_invalid", "The managed-copy locator escapes its root.");
  }
  return candidate;
}

function bindingRevision(bindings: VaultBindingsFile, binding: ExternalManagedCopyRootBinding): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify({ binding, defaults: bindings.defaults })).digest("hex")}`;
}

function sourceStorageRevision(
  vaultId: string,
  mode: "inside_vault" | "external_binding",
  bindings: VaultBindingsFile
): `ssrev_${string}` {
  const selected = bindings.defaults.find((entry) => entry.vaultId === vaultId);
  const binding = selected && bindings.roots.find((entry) => entry.rootId === selected.rootId && entry.vaultId === vaultId);
  return `ssrev_${createHash("sha256").update(JSON.stringify({ vaultId, mode, selected, binding })).digest("hex")}`;
}

function assertDistinctPaths(roots: readonly ExternalManagedCopyRootBinding[]): void {
  const seen = new Set<string>();
  for (const root of roots) {
    const normalized = process.platform === "win32" ? path.resolve(root.absolutePath).toLowerCase() : path.resolve(root.absolutePath);
    if (seen.has(normalized)) throw new PigeDomainError("managed_copy.root_binding_conflict", "Multiple roots use one machine path.");
    seen.add(normalized);
  }
}

function sameRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}
