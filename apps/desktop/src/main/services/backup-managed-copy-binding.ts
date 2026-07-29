import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  RootBindingIdSchema,
  SourceIdSchema,
  SourceRecordSchema,
  type BackupManifest,
  type ExternalManagedCopyRootBinding,
  type SourceRecord
} from "@pige/schemas";
import { readVaultManifest } from "./vault-layout";
import { ManagedCopyRootService } from "./managed-copy-root-service";

export interface BackupManagedCopyDependencyIdentity {
  readonly dependencyKind: "vault_binding" | "external_source";
  readonly dependencyId: string;
}

export interface BackupManagedCopyRepairProof extends BackupManagedCopyDependencyIdentity {
  readonly vaultId: string;
  readonly rootId: string;
  readonly proofDigest: `sha256:${string}`;
}

export function parseIncompleteManagedCopyRootIds(rootIds: readonly string[] | undefined): ReadonlySet<string> {
  const parsed = new Set(rootIds ?? []);
  if (parsed.size > 8 || [...parsed].some((rootId) =>
    RootBindingIdSchema.safeParse(rootId).success === false || rootId === "root_vault_managed"
  )) throw new PigeDomainError("backup.incomplete_omission_invalid", "Backup omission authority is invalid.");
  return parsed;
}

export function recordIncompleteManagedCopyRoot(
  rootId: string,
  omittedRootIds: ReadonlySet<string>,
  recordedRootIds: Set<string>,
  dependencies: BackupManifest["externalDependencies"]
): boolean {
  if (!omittedRootIds.has(rootId)) return false;
  if (!recordedRootIds.has(rootId)) dependencies.push({
    kind: "external_managed_copy_root",
    rootId,
    included: false,
    requiredForCompleteRestore: true
  });
  recordedRootIds.add(rootId);
  return true;
}

export function assertDistinctBindingPaths(roots: readonly ExternalManagedCopyRootBinding[]): void {
  const seen = new Set<string>();
  for (const root of roots) {
    if (!path.isAbsolute(root.absolutePath)) {
      throw new PigeDomainError("backup.root_binding_invalid", "An external root binding path is not absolute.");
    }
    const normalized = path.resolve(root.absolutePath);
    const key = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
    if (seen.has(key)) {
      throw new PigeDomainError(
        "backup.root_binding_conflict",
        "Multiple external managed-copy root IDs resolve to the same machine path."
      );
    }
    seen.add(key);
  }
}

export function captureCanonicalBindingDirectory(directoryPathInput: string): string {
  const directoryPath = path.resolve(directoryPathInput);
  const identity = fs.lstatSync(directoryPath);
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new PigeDomainError("backup.root_binding_registry_invalid", "Machine app-data storage is unsafe.");
  }
  const canonical = fs.realpathSync.native(directoryPath);
  if (canonical !== directoryPath) {
    throw new PigeDomainError("backup.root_binding_registry_invalid", "Machine app-data storage is not canonical.");
  }
  return canonical;
}

export function proveManagedCopyDependency(
  userDataPathInput: string | undefined,
  vaultPathInput: string,
  vaultId: string,
  dependency: BackupManagedCopyDependencyIdentity
): BackupManagedCopyRepairProof | undefined {
  if (!userDataPathInput) return undefined;
  try {
    const vaultPath = fs.realpathSync.native(path.resolve(vaultPathInput));
    if (readVaultManifest(vaultPath).vault_id !== vaultId) return undefined;
    const target = resolveDependency(vaultPath, dependency);
    const binding = new ManagedCopyRootService(userDataPathInput).binding(vaultId, target.rootId);
    if (!binding) return undefined;
    const evidence = target.records.map((record) => verifyManagedCopy(binding.rootPath, record));
    return {
      ...dependency,
      vaultId,
      rootId: target.rootId,
      proofDigest: digest([
        vaultId,
        dependency.dependencyKind,
        dependency.dependencyId,
        binding.rootId,
        binding.rootPath,
        binding.revision,
        ...evidence.sort()
      ].join("\0"))
    };
  } catch {
    return undefined;
  }
}

export function repairManagedCopyDependency(
  userDataPathInput: string | undefined,
  vaultPathInput: string,
  vaultId: string,
  dependency: BackupManagedCopyDependencyIdentity,
  selectedDirectoryInput: string
): BackupManagedCopyRepairProof {
  if (!userDataPathInput) {
    throw new PigeDomainError("backup.root_binding_registry_invalid", "The root registry is unavailable.");
  }
  const vaultPath = fs.realpathSync.native(path.resolve(vaultPathInput));
  if (readVaultManifest(vaultPath).vault_id !== vaultId) {
    throw new PigeDomainError("backup.reconnect_stale", "The active vault changed before reconnect.");
  }
  const target = resolveDependency(vaultPath, dependency);
  const selectedDirectory = captureCanonicalDirectory(selectedDirectoryInput);
  try {
    for (const record of target.records) verifyManagedCopy(selectedDirectory, record);
  } catch {
    throw new PigeDomainError("backup.reconnect_selection_invalid", "The selected directory does not match.");
  }
  new ManagedCopyRootService(userDataPathInput).repairBinding(vaultId, target.rootId, selectedDirectory);
  const proof = proveManagedCopyDependency(userDataPathInput, vaultPath, vaultId, dependency);
  if (!proof) throw new PigeDomainError("backup.reconnect_failed", "The repaired root failed exact readback.");
  return proof;
}

function resolveDependency(
  vaultPath: string,
  dependency: BackupManagedCopyDependencyIdentity
): { readonly rootId: string; readonly records: readonly SourceRecord[] } {
  const recordsPath = path.join(vaultPath, ".pige", "source-records");
  const records: SourceRecord[] = [];
  if (dependency.dependencyKind === "external_source") {
    const sourceId = SourceIdSchema.parse(dependency.dependencyId);
    const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1];
    const candidates = [
      ...(dateKey ? [path.join(recordsPath, dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`)] : []),
      path.join(recordsPath, `${sourceId}.json`)
    ].filter((recordPath) => fs.existsSync(recordPath));
    if (candidates.length === 0) {
      throw new PigeDomainError("backup.reconnect_not_found", "The managed source record no longer exists.");
    }
    if (candidates.length !== 1) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The managed source identity is ambiguous.");
    }
    records.push(readSourceRecord(candidates[0]!));
  } else {
    RootBindingIdSchema.parse(dependency.dependencyId);
    if (!fs.existsSync(recordsPath)) {
      throw new PigeDomainError("backup.reconnect_not_found", "The managed source root has no records.");
    }
    for (const recordPath of listSourceRecordPaths(recordsPath)) {
      const record = readSourceRecord(recordPath);
      if (record.managedCopy?.rootId === dependency.dependencyId) records.push(record);
    }
  }
  const rootIds = new Set(records.map((record) => record.managedCopy?.rootId).filter(Boolean));
  const rootId = [...rootIds][0];
  if (records.length === 0) {
    throw new PigeDomainError("backup.reconnect_not_found", "The managed source dependency no longer exists.");
  }
  if (rootIds.size !== 1 || !rootId || rootId === "root_vault_managed") {
    throw new PigeDomainError("backup.reconnect_mismatch", "The managed source dependency no longer matches.");
  }
  if (
    dependency.dependencyKind === "vault_binding" && rootId !== dependency.dependencyId ||
    dependency.dependencyKind === "external_source" && records[0]?.id !== dependency.dependencyId
  ) throw new PigeDomainError("backup.reconnect_mismatch", "The managed source dependency changed.");
  return { rootId, records: records.sort((left, right) => left.id.localeCompare(right.id)) };
}

function listSourceRecordPaths(recordsPath: string): readonly string[] {
  const paths: string[] = [];
  const visit = (directoryPath: string, depth: number): void => {
    const directory = fs.lstatSync(directoryPath);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The managed source registry is unsafe.");
    }
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PigeDomainError("backup.reconnect_mismatch", "The managed source registry contains a symbolic link.");
      }
      if (entry.isFile() && entry.name.endsWith(".json")) paths.push(entryPath);
      else if (entry.isDirectory() && depth < 2) visit(entryPath, depth + 1);
    }
  };
  visit(recordsPath, 0);
  return paths.sort();
}

function readSourceRecord(filePath: string): SourceRecord {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    const atPath = fs.lstatSync(filePath);
    if (!before.isFile() || atPath.isSymbolicLink() || before.nlink !== 1 || !sameRevision(before, atPath)) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The managed source record is unsafe.");
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.byteLength > 4 * 1024 * 1024 || !sameRevision(before, fs.fstatSync(descriptor))) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The managed source record changed.");
    }
    return SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  } finally {
    fs.closeSync(descriptor);
  }
}

function verifyManagedCopy(rootPath: string, record: SourceRecord): string {
  const managedCopy = record.managedCopy;
  if (!managedCopy || managedCopy.pathBasis !== "root_relative") {
    throw new PigeDomainError("backup.reconnect_mismatch", "The managed source locator is incompatible.");
  }
  const segments = managedCopy.path.split("/");
  if (!managedCopy.path || path.isAbsolute(managedCopy.path) || segments.some((part) => part === "" || part === "." || part === "..")) {
    throw new PigeDomainError("backup.reconnect_mismatch", "The managed source locator is unsafe.");
  }
  const absolutePath = path.resolve(rootPath, ...segments);
  if (!inside(absolutePath, rootPath) || absolutePath === rootPath) {
    throw new PigeDomainError("backup.reconnect_mismatch", "The managed source locator escapes its root.");
  }
  let current = rootPath;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const identity = fs.lstatSync(current);
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw new PigeDomainError("backup.reconnect_mismatch", "The managed source parent is unsafe.");
    }
  }
  const descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    const atPath = fs.lstatSync(absolutePath);
    if (
      !before.isFile() || atPath.isSymbolicLink() || before.nlink !== 1 ||
      !sameRevision(before, atPath) || fs.realpathSync.native(absolutePath) !== absolutePath
    ) throw new PigeDomainError("backup.reconnect_mismatch", "The managed source file is unsafe.");
    const bytes = fs.readFileSync(descriptor);
    if (
      !sameRevision(before, fs.fstatSync(descriptor)) || bytes.byteLength !== managedCopy.size ||
      digest(bytes) !== managedCopy.checksum
    ) throw new PigeDomainError("backup.reconnect_mismatch", "The managed source identity changed.");
    return `${record.id}\0${managedCopy.path}\0${managedCopy.checksum}\0${managedCopy.size}`;
  } finally {
    fs.closeSync(descriptor);
  }
}

function captureCanonicalDirectory(input: string): string {
  const resolved = path.resolve(input);
  const identity = fs.lstatSync(resolved);
  if (!identity.isDirectory() || identity.isSymbolicLink() || fs.realpathSync.native(resolved) !== resolved) {
    throw new PigeDomainError("backup.root_binding_invalid", "The selected root is not canonical.");
  }
  return resolved;
}

function inside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sameRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function digest(value: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
