import fs, { constants as fsConstants, type Stats } from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { OperationRecordSchema, type OperationRecord } from "@pige/schemas";

const MAX_OPERATION_BYTES = 256 * 1_024;

export class ExternalOperationRecordStore {
  write(vaultPathInput: string, operation: OperationRecord, assertWriterLease: () => void): OperationRecord {
    const parsed = OperationRecordSchema.parse(operation);
    const dateKey = /^op_(\d{8})_[a-z0-9]{8,}$/u.exec(parsed.id)?.[1];
    if (!dateKey) throw operationInvalid();
    const vaultPath = captureVaultRoot(vaultPathInput);
    const operationRoot = ensureOwnedDirectory(vaultPath, ".pige");
    const operations = ensureOwnedDirectory(operationRoot, "operations", true);
    const year = ensureOwnedDirectory(operations, dateKey.slice(0, 4), true);
    const month = ensureOwnedDirectory(year, dateKey.slice(4, 6), true);
    const operationPath = path.join(month, `${parsed.id}.json`);
    const existing = readOptional(operationPath);
    if (existing) return acceptSame(existing, parsed);
    assertWriterLease();
    try {
      writeNoReplace(operationPath, parsed);
      fsyncDirectory(month);
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
      return acceptSame(readRequired(operationPath), parsed);
    }
    assertWriterLease();
    return acceptSame(readRequired(operationPath), parsed);
  }
}

function readOptional(operationPath: string): OperationRecord | undefined {
  try {
    return readRequired(operationPath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw caught;
  }
}

function readRequired(operationPath: string): OperationRecord {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(operationPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.nlink !== 1 ||
      !isOwned(stats) ||
      (stats.mode & 0o077) !== 0 ||
      stats.size > MAX_OPERATION_BYTES
    ) throw operationInvalid();
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(descriptor, "utf8")));
  } catch (caught) {
    if (caught instanceof PigeDomainError || isErrno(caught, "ENOENT")) throw caught;
    throw operationInvalid();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeNoReplace(operationPath: string, operation: OperationRecord): void {
  const bytes = `${JSON.stringify(operation, null, 2)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_OPERATION_BYTES) throw operationInvalid();
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      operationPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function captureVaultRoot(vaultPathInput: string): string {
  try {
    const vaultPath = path.resolve(vaultPathInput);
    const stats = fs.lstatSync(vaultPath);
    if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwned(stats)) throw operationInvalid();
    const realPath = fs.realpathSync.native(vaultPath);
    if (realPath !== vaultPath) throw operationInvalid();
    return vaultPath;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw operationInvalid();
  }
}

function ensureOwnedDirectory(parentPath: string, name: string, create = false): string {
  const directoryPath = path.join(parentPath, name);
  try {
    if (create) {
      try {
        fs.mkdirSync(directoryPath, { mode: 0o700 });
        fsyncDirectory(parentPath);
      } catch (caught) {
        if (!isErrno(caught, "EEXIST")) throw caught;
      }
    }
    const stats = fs.lstatSync(directoryPath);
    if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwned(stats)) throw operationInvalid();
    const realPath = fs.realpathSync.native(directoryPath);
    if (realPath !== directoryPath) throw operationInvalid();
    return directoryPath;
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw operationInvalid();
  }
}

function acceptSame(existing: OperationRecord, expected: OperationRecord): OperationRecord {
  if (JSON.stringify(existing) !== JSON.stringify(expected)) throw operationConflict();
  return existing;
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isOwned(stats: Stats): boolean {
  return typeof process.getuid !== "function" || stats.uid === process.getuid();
}

function operationInvalid(): PigeDomainError {
  return new PigeDomainError("external_mutation.operation_invalid", "The external mutation Operation is invalid.");
}

function operationConflict(): PigeDomainError {
  return new PigeDomainError("external_mutation.operation_conflict", "The external mutation Operation changed concurrently.");
}

function isErrno(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}
