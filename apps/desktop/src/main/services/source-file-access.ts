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
    const absolutePath = resolveVaultRelativePath(vaultPath, parsed.managedCopy.path);
    return verifyFile(absolutePath, parsed.managedCopy.size, parsed.managedCopy.checksum, "managed_copy");
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
    return verifyFileAsync(
      resolveVaultRelativePath(vaultPath, parsed.managedCopy.path),
      parsed.managedCopy.size,
      parsed.managedCopy.checksum,
      "managed_copy"
    );
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
    const snapshot = await createVerifiedFileSnapshot({
      sourcePath: resolveVaultRelativePath(vaultPath, parsed.managedCopy.path),
      expectedSize: parsed.managedCopy.size,
      expectedChecksum: parsed.managedCopy.checksum,
      unavailableCode: "source.managed_unavailable",
      integrityCode: "source.checksum_mismatch",
      containmentRoot: vaultPath
    });
    return { ...snapshot, location: "managed_copy" };
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
      descriptor.managedCopy?.destinationPath !== canonicalManagedCopyPath(vaultPath, managedCopy.path) ||
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

function canonicalManagedCopyPath(vaultPath: string, managedCopyPath: string): string {
  try {
    return fs.realpathSync(resolveVaultRelativePath(vaultPath, managedCopyPath));
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw ingressDescriptorMismatch();
  }
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

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("source.path_outside_vault", "The managed source path escapes the active vault.")
);
