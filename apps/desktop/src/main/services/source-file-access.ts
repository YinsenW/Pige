import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import {
  ingressSnapshotService,
  type IngressSnapshotBinding,
  type IngressSnapshotDescriptor,
  type IngressSnapshotReadLease
} from "./ingress-snapshot-service";
import { createVaultRelativePathResolver, readVaultManifest } from "./vault-layout";
import { createVerifiedFileSnapshot } from "./verified-file-snapshot";

export interface ManagedCopyLocatorLease {
  readonly absolutePath: string;
  readonly containmentRoot: string;
  assertCurrent(): void;
  release(): void;
}

export interface ManagedCopyLocatorResolver {
  resolve(vaultId: string, vaultPath: string, managedCopy: NonNullable<SourceRecord["managedCopy"]>): ManagedCopyLocatorLease;
}

let managedCopyLocatorResolver: ManagedCopyLocatorResolver | undefined;

export function configureManagedCopyLocatorResolver(resolver: ManagedCopyLocatorResolver | undefined): void {
  managedCopyLocatorResolver = resolver;
}

export interface VerifiedSourceFile {
  readonly absolutePath: string;
  readonly checksum: string;
  readonly size: number;
  readonly location: "managed_copy" | "referenced_original";
}

export interface VerifiedSourceFileSnapshot extends VerifiedSourceFile {
  dispose(): Promise<void>;
}

export interface VerifiedSourceTextPrefix {
  readonly text: string;
  readonly complete: boolean;
}

export interface CurrentSourceRecordSnapshot {
  readonly record: SourceRecord;
  readonly identity: {
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
    readonly deviceId: string;
    readonly fileId: string;
  };
}

export function readCurrentSourceRecordSnapshot(
  vaultPath: string,
  sourceId: string
): CurrentSourceRecordSnapshot | undefined {
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const root = path.resolve(vaultPath, ".pige", "source-records");
  const filePath = path.resolve(root, dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`);
  if (!filePath.startsWith(`${root}${path.sep}`)) return undefined;
  let descriptor: number | undefined;
  try {
    const namedBefore = assertConfinedSourceRecordPath(vaultPath, root, filePath);
    if (namedBefore.size > 2 * 1024 * 1024 || namedBefore.nlink !== 1) return undefined;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1 || !sameSourceRecordIdentity(namedBefore, before)) return undefined;
    const bytes = Buffer.alloc(before.size);
    if (fs.readSync(descriptor, bytes, 0, before.size, 0) !== before.size) return undefined;
    const after = fs.fstatSync(descriptor);
    const namedAfter = assertConfinedSourceRecordPath(vaultPath, root, filePath);
    if (after.nlink !== 1 || namedAfter.nlink !== 1 ||
        !sameSourceRecordIdentity(before, after) || !sameSourceRecordIdentity(after, namedAfter)) return undefined;
    const parsed = SourceRecordSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    return parsed.success && parsed.data.id === sourceId
      ? { record: parsed.data, identity: sourceRecordIdentity(after) }
      : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readBoundedSourceFileNoFollow(filePath: string, maxBytes: number): Buffer {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    const atPath = fs.lstatSync(filePath);
    if (!before.isFile() || atPath.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes)
      throw new PigeDomainError("source.changed", "The source is unavailable or unsafe.");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new PigeDomainError("source.changed", "The source changed while it was read.");
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

export function verifyReadableSourceFile(vaultPath: string, sourceRecord: SourceRecord): VerifiedSourceFile {
  const parsed = SourceRecordSchema.parse(sourceRecord);
  const ingress = acquireIngressSnapshot(vaultPath, parsed);
  if (ingress) {
    try {
      return verifyFile(ingress.lease.absolutePath, ingress.lease.size, ingress.lease.checksum, ingress.location);
    } finally {
      ingress.lease.release();
    }
  }
  if (parsed.storageStrategy === "copy_to_source_library" && parsed.managedCopy?.path) {
    const locator = resolveManagedCopyLocator(vaultPath, parsed);
    try {
      const verified = verifyFile(locator.absolutePath, parsed.managedCopy.size, parsed.managedCopy.checksum, "managed_copy");
      locator.assertCurrent();
      return verified;
    } finally {
      locator.release();
    }
  }
  if (
    parsed.storageStrategy === "reference_original" &&
    parsed.original?.path &&
    parsed.original.checksum &&
    parsed.original.lastKnownSize !== undefined
  ) {
    if (!path.isAbsolute(parsed.original.path)) {
      throw new PigeDomainError("source.reference_invalid", "The referenced original path is not absolute.");
    }
    return verifyFile(
      path.resolve(parsed.original.path),
      parsed.original.lastKnownSize,
      parsed.original.checksum,
      "referenced_original"
    );
  }
  throw new PigeDomainError("source.unavailable", "The Source Record has no verifiable source file locator.");
}

export function tryVerifyReadableSourceFile(vaultPath: string, sourceRecord: SourceRecord): VerifiedSourceFile | undefined {
  try {
    return verifyReadableSourceFile(vaultPath, sourceRecord);
  } catch {
    return undefined;
  }
}

export function verifyRevealableSourceFile(vaultPath: string, sourceRecord: SourceRecord): VerifiedSourceFile {
  const parsed = SourceRecordSchema.parse(sourceRecord);
  if (parsed.storageStrategy === "copy_to_source_library" && parsed.managedCopy?.path) {
    const locator = resolveManagedCopyLocator(vaultPath, parsed);
    try {
      const verified = verifyFile(
        locator.absolutePath,
        parsed.managedCopy.size,
        parsed.managedCopy.checksum,
        "managed_copy"
      );
      locator.assertCurrent();
      return verified;
    } finally {
      locator.release();
    }
  }
  if (
    parsed.storageStrategy === "reference_original" &&
    parsed.original?.path &&
    parsed.original.checksum &&
    parsed.original.lastKnownSize !== undefined
  ) {
    if (!path.isAbsolute(parsed.original.path)) {
      throw new PigeDomainError("source.reference_invalid", "The referenced original path is not absolute.");
    }
    const ingress = acquireIngressSnapshot(vaultPath, parsed);
    ingress?.lease.release();
    return verifyFile(
      path.resolve(parsed.original.path),
      parsed.original.lastKnownSize,
      parsed.original.checksum,
      "referenced_original"
    );
  }
  throw new PigeDomainError("source.unavailable", "The Source Record has no revealable source file locator.");
}

export async function verifyReadableSourceFileAsync(
  vaultPath: string,
  sourceRecord: SourceRecord
): Promise<VerifiedSourceFile> {
  const parsed = SourceRecordSchema.parse(sourceRecord);
  const ingress = await acquireIngressSnapshotAsync(vaultPath, parsed);
  if (ingress) {
    try {
      return await verifyFileAsync(
        ingress.lease.absolutePath,
        ingress.lease.size,
        ingress.lease.checksum,
        ingress.location
      );
    } finally {
      ingress.lease.release();
    }
  }
  if (parsed.storageStrategy === "copy_to_source_library" && parsed.managedCopy?.path) {
    const locator = resolveManagedCopyLocator(vaultPath, parsed);
    try {
      const verified = await verifyFileAsync(locator.absolutePath, parsed.managedCopy.size, parsed.managedCopy.checksum, "managed_copy");
      locator.assertCurrent();
      return verified;
    } finally {
      locator.release();
    }
  }
  if (
    parsed.storageStrategy === "reference_original" &&
    parsed.original?.path &&
    parsed.original.checksum &&
    parsed.original.lastKnownSize !== undefined
  ) {
    if (!path.isAbsolute(parsed.original.path)) {
      throw new PigeDomainError("source.reference_invalid", "The referenced original path is not absolute.");
    }
    return verifyFileAsync(
      path.resolve(parsed.original.path),
      parsed.original.lastKnownSize,
      parsed.original.checksum,
      "referenced_original"
    );
  }
  throw new PigeDomainError("source.unavailable", "The Source Record has no verifiable source file locator.");
}

export async function tryVerifyReadableSourceFileAsync(
  vaultPath: string,
  sourceRecord: SourceRecord
): Promise<VerifiedSourceFile | undefined> {
  try {
    return await verifyReadableSourceFileAsync(vaultPath, sourceRecord);
  } catch {
    return undefined;
  }
}

export async function createVerifiedSourceFileSnapshotAsync(
  vaultPath: string,
  sourceRecord: SourceRecord
): Promise<VerifiedSourceFileSnapshot> {
  const parsed = SourceRecordSchema.parse(sourceRecord);
  const ingress = await acquireIngressSnapshotAsync(vaultPath, parsed);
  if (ingress) {
    return {
      absolutePath: ingress.lease.absolutePath,
      checksum: ingress.lease.checksum,
      size: ingress.lease.size,
      location: ingress.location,
      dispose: async () => ingress.lease.release()
    };
  }
  if (parsed.storageStrategy === "copy_to_source_library" && parsed.managedCopy?.path) {
    const locator = resolveManagedCopyLocator(vaultPath, parsed);
    const snapshot = await createVerifiedFileSnapshot({
      sourcePath: locator.absolutePath,
      expectedSize: parsed.managedCopy.size,
      expectedChecksum: parsed.managedCopy.checksum,
      unavailableCode: "source.managed_unavailable",
      integrityCode: "source.checksum_mismatch",
      containmentRoot: locator.containmentRoot
    });
    try {
      locator.assertCurrent();
      return {
        ...snapshot,
        location: "managed_copy",
        dispose: async () => {
          try { await snapshot.dispose(); } finally { locator.release(); }
        }
      };
    } catch (caught) {
      await snapshot.dispose();
      locator.release();
      throw caught;
    }
  }
  if (
    parsed.storageStrategy === "reference_original" &&
    parsed.original?.path &&
    parsed.original.checksum &&
    parsed.original.lastKnownSize !== undefined
  ) {
    if (!path.isAbsolute(parsed.original.path)) {
      throw new PigeDomainError("source.reference_invalid", "The referenced original path is not absolute.");
    }
    const snapshot = await createVerifiedFileSnapshot({
      sourcePath: path.resolve(parsed.original.path),
      expectedSize: parsed.original.lastKnownSize,
      expectedChecksum: parsed.original.checksum,
      unavailableCode: "source.external_unavailable",
      integrityCode: "source.checksum_mismatch"
    });
    return { ...snapshot, location: "referenced_original" };
  }
  throw new PigeDomainError("source.unavailable", "The Source Record has no verifiable source file locator.");
}

export function readVerifiedSourceTextPrefix(
  vaultPath: string,
  sourceRecord: SourceRecord,
  maximumBytes: number
): VerifiedSourceTextPrefix | undefined {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new PigeDomainError("source.read_invalid", "The source preview byte limit is invalid.");
  }
  const parsed = SourceRecordSchema.parse(sourceRecord);
  const ingress = acquireIngressSnapshot(vaultPath, parsed);
  if (ingress) {
    try {
      return readTextPrefix(ingress.lease.absolutePath, ingress.lease.size, maximumBytes);
    } finally {
      ingress.lease.release();
    }
  }
  try {
    const verified = verifyReadableSourceFile(vaultPath, parsed);
    return readTextPrefix(verified.absolutePath, verified.size, maximumBytes);
  } catch {
    return undefined;
  }
}

interface AcquiredIngressSnapshot {
  readonly lease: IngressSnapshotReadLease;
  readonly location: VerifiedSourceFile["location"];
}

function acquireIngressSnapshot(vaultPath: string, sourceRecord: SourceRecord): AcquiredIngressSnapshot | undefined {
  const binding = ingressBinding(vaultPath, sourceRecord);
  if (!binding) return undefined;
  const lease = ingressSnapshotService.acquireRead(vaultPath, binding);
  try {
    assertIngressDescriptorMatchesSource(lease.descriptor, sourceRecord, vaultPath);
    if (sourceRecord.storageStrategy === "reference_original") {
      assertReferencedOriginalCurrent(lease.descriptor);
    }
    return { lease, location: logicalLocation(sourceRecord) };
  } catch (caught) {
    lease.release();
    throw caught;
  }
}

async function acquireIngressSnapshotAsync(
  vaultPath: string,
  sourceRecord: SourceRecord
): Promise<AcquiredIngressSnapshot | undefined> {
  const binding = ingressBinding(vaultPath, sourceRecord);
  if (!binding) return undefined;
  if (sourceRecord.storageStrategy === "reference_original") {
    await ingressSnapshotService.proveReferencedOriginalCurrent(vaultPath, binding);
  }
  const lease = await ingressSnapshotService.acquireReadAsync(vaultPath, binding);
  try {
    assertIngressDescriptorMatchesSource(lease.descriptor, sourceRecord, vaultPath);
    return { lease, location: logicalLocation(sourceRecord) };
  } catch (caught) {
    lease.release();
    throw caught;
  }
}

function ingressBinding(vaultPath: string, sourceRecord: SourceRecord): IngressSnapshotBinding | undefined {
  const parentJobId = sourceRecord.metadata.agentTurnJobId;
  const ordinal = sourceRecord.metadata.agentTurnAttachmentOrdinal;
  if (
    !sourceRecord.original?.path ||
    !path.isAbsolute(sourceRecord.original.path) ||
    typeof parentJobId !== "string" ||
    !Number.isInteger(ordinal)
  ) return undefined;
  return {
    vaultId: readVaultManifest(vaultPath).vault_id,
    parentJobId,
    sourceId: sourceRecord.id,
    ordinal: ordinal as number
  };
}

function assertIngressDescriptorMatchesSource(
  descriptor: IngressSnapshotDescriptor,
  sourceRecord: SourceRecord,
  vaultPath: string
): void {
  const original = sourceRecord.original;
  if (
    !original?.path ||
    descriptor.sourceProvenance.originalPath !== path.resolve(original.path) ||
    descriptor.checksum !== original.checksum ||
    descriptor.size !== original.lastKnownSize
  ) throw ingressDescriptorMismatch();
  if (sourceRecord.storageStrategy === "copy_to_source_library") {
    const managedCopy = sourceRecord.managedCopy;
    if (
      !managedCopy ||
      descriptor.managedCopy?.destinationPath !== canonicalManagedCopyPath(vaultPath, sourceRecord) ||
      descriptor.managedCopy.checksum !== managedCopy.checksum ||
      descriptor.managedCopy.size !== managedCopy.size
    ) throw ingressDescriptorMismatch();
  } else if (sourceRecord.storageStrategy !== "reference_original" || sourceRecord.managedCopy) {
    throw ingressDescriptorMismatch();
  }
}

function assertReferencedOriginalCurrent(descriptor: IngressSnapshotDescriptor): void {
  const originalPath = descriptor.sourceProvenance.originalPath;
  let stat: fs.Stats;
  let realPath: string;
  try {
    stat = fs.lstatSync(originalPath);
    realPath = fs.realpathSync(originalPath);
  } catch {
    throw ingressSourceUnavailable();
  }
  const identity = descriptor.sourceProvenance.identity;
  if (!stat.isFile() || stat.isSymbolicLink() || !realPath) throw ingressSourceUnavailable();
  if (
    stat.dev !== identity.device ||
    stat.ino !== identity.inode ||
    stat.size !== identity.size ||
    stat.mtimeMs !== identity.modifiedAtMs ||
    stat.ctimeMs !== identity.changedAtMs ||
    checksumFile(originalPath) !== descriptor.checksum
  ) throw ingressSourceChanged();
}

function logicalLocation(sourceRecord: SourceRecord): VerifiedSourceFile["location"] {
  return sourceRecord.storageStrategy === "reference_original" ? "referenced_original" : "managed_copy";
}

function canonicalManagedCopyPath(vaultPath: string, sourceRecord: SourceRecord): string {
  const locator = resolveManagedCopyLocator(vaultPath, sourceRecord);
  try {
    const canonical = fs.realpathSync(locator.absolutePath);
    locator.assertCurrent();
    return canonical;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw ingressDescriptorMismatch();
  } finally {
    locator.release();
  }
}

function resolveManagedCopyLocator(vaultPath: string, sourceRecord: SourceRecord): ManagedCopyLocatorLease {
  const managedCopy = sourceRecord.managedCopy;
  if (!managedCopy) throw new PigeDomainError("source.managed_locator_invalid", "The managed-copy locator is missing.");
  if (!managedCopy.rootId || managedCopy.rootId === "root_vault_managed") {
    return {
      absolutePath: resolveVaultRelativePath(vaultPath, managedCopy.path),
      containmentRoot: path.resolve(vaultPath),
      assertCurrent: () => undefined,
      release: () => undefined
    };
  }
  if (!managedCopyLocatorResolver) {
    throw new PigeDomainError("source.managed_unavailable", "The external managed-copy root resolver is unavailable.");
  }
  return managedCopyLocatorResolver.resolve(readVaultManifest(vaultPath).vault_id, vaultPath, managedCopy);
}

function readTextPrefix(filePath: string, size: number, maximumBytes: number): VerifiedSourceTextPrefix {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const bytes = Buffer.allocUnsafe(Math.min(size, maximumBytes));
    const bytesRead = bytes.length === 0 ? 0 : fs.readSync(descriptor, bytes, 0, bytes.length, 0);
    return { text: bytes.subarray(0, bytesRead).toString("utf8"), complete: size <= maximumBytes };
  } finally {
    fs.closeSync(descriptor);
  }
}

function ingressDescriptorMismatch(): PigeDomainError {
  return new PigeDomainError(
    "ingress_snapshot.descriptor_mismatch",
    "The private ingress snapshot identity does not match its durable owner."
  );
}

function ingressSourceUnavailable(): PigeDomainError {
  return new PigeDomainError(
    "ingress_snapshot.source_unavailable",
    "The accepted source file is unavailable for private snapshot access."
  );
}

function ingressSourceChanged(): PigeDomainError {
  return new PigeDomainError(
    "ingress_snapshot.source_changed",
    "The accepted source file changed across its private snapshot boundary."
  );
}

function verifyFile(
  absolutePath: string,
  expectedSize: number,
  expectedChecksum: string,
  location: VerifiedSourceFile["location"]
): VerifiedSourceFile {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    throw new PigeDomainError(
      location === "referenced_original" ? "source.external_unavailable" : "source.managed_unavailable",
      "The recorded source file is unavailable."
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PigeDomainError(
      location === "referenced_original" ? "source.external_unavailable" : "source.managed_unavailable",
      "The recorded source locator is not a regular file."
    );
  }
  if (stat.size !== expectedSize) {
    throw new PigeDomainError("source.checksum_mismatch", "The recorded source file size has changed.");
  }
  const checksum = checksumFile(absolutePath);
  if (checksum !== expectedChecksum) {
    throw new PigeDomainError("source.checksum_mismatch", "The recorded source file checksum has changed.");
  }
  return { absolutePath, checksum, size: stat.size, location };
}

async function verifyFileAsync(
  absolutePath: string,
  expectedSize: number,
  expectedChecksum: string,
  location: VerifiedSourceFile["location"]
): Promise<VerifiedSourceFile> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(absolutePath);
  } catch {
    throw new PigeDomainError(
      location === "referenced_original" ? "source.external_unavailable" : "source.managed_unavailable",
      "The recorded source file is unavailable."
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PigeDomainError(
      location === "referenced_original" ? "source.external_unavailable" : "source.managed_unavailable",
      "The recorded source locator is not a regular file."
    );
  }
  if (stat.size !== expectedSize) {
    throw new PigeDomainError("source.checksum_mismatch", "The recorded source file size has changed.");
  }
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(absolutePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  const checksum = `sha256:${hash.digest("hex")}`;
  if (checksum !== expectedChecksum) {
    throw new PigeDomainError("source.checksum_mismatch", "The recorded source file checksum has changed.");
  }
  return { absolutePath, checksum, size: stat.size, location };
}

function checksumFile(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return `sha256:${hash.digest("hex")}`;
}

function assertConfinedSourceRecordPath(vaultPath: string, root: string, filePath: string): fs.Stats {
  const resolvedVault = path.resolve(vaultPath);
  const vaultStat = fs.lstatSync(resolvedVault);
  if (vaultStat.isSymbolicLink() || !vaultStat.isDirectory()) throw new Error("The vault root is unsafe.");
  const canonicalVault = fs.realpathSync.native(resolvedVault);
  for (const directory of [path.join(resolvedVault, ".pige"), root]) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("The Source Record root is unsafe.");
  }
  const canonicalRoot = fs.realpathSync.native(root);
  const rootRelative = path.relative(canonicalVault, canonicalRoot);
  if (!rootRelative || rootRelative.startsWith(`..${path.sep}`) || path.isAbsolute(rootRelative)) {
    throw new Error("The Source Record root escaped the vault.");
  }
  let parent = path.dirname(filePath);
  while (true) {
    const stat = fs.lstatSync(parent);
    const relative = path.relative(canonicalRoot, fs.realpathSync.native(parent));
    if (stat.isSymbolicLink() || !stat.isDirectory() || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("A Source Record parent is unsafe.");
    }
    if (path.resolve(parent) === path.resolve(root)) break;
    const next = path.dirname(parent);
    if (next === parent) throw new Error("The Source Record parent chain is invalid.");
    parent = next;
  }
  const named = fs.lstatSync(filePath);
  const canonicalFile = fs.realpathSync.native(filePath);
  if (named.isSymbolicLink() || !named.isFile() || !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("The Source Record escaped its durable root.");
  }
  return named;
}

function sourceRecordIdentity(stat: fs.Stats): CurrentSourceRecordSnapshot["identity"] {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    deviceId: String(stat.dev),
    fileId: String(stat.ino)
  };
}

function sameSourceRecordIdentity(left: fs.Stats, right: fs.Stats): boolean {
  const a = sourceRecordIdentity(left);
  const b = sourceRecordIdentity(right);
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs &&
    a.deviceId === b.deviceId && a.fileId === b.fileId;
}

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("source.path_outside_vault", "The managed source path escapes the active vault.")
);
