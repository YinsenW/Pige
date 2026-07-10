import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
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

export function verifyReadableSourceFile(vaultPath: string, sourceRecord: SourceRecord): VerifiedSourceFile {
  const parsed = SourceRecordSchema.parse(sourceRecord);
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

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("source.path_outside_vault", "The managed source path escapes the active vault.");
  }
  return resolvedPath;
}
