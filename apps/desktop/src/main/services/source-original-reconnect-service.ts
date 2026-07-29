import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { createVerifiedFileSnapshot } from "./verified-file-snapshot";
import { tryVerifyReadableSourceFile } from "./source-file-access";

export interface SourceOriginalReconnectVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface SourceOriginalReconnectBinding {
  readonly activeVaultId: string;
  readonly sourceId: string;
}

interface SourceRecordSnapshot {
  readonly filePath: string;
  readonly checksum: string;
  readonly record: SourceRecord;
}

export class SourceOriginalReconnectService {
  readonly #vaults: SourceOriginalReconnectVaultPort;

  constructor(vaults: SourceOriginalReconnectVaultPort) {
    this.#vaults = vaults;
  }

  async reconnect(
    binding: SourceOriginalReconnectBinding,
    selectedPath: string,
    assertCurrent: () => boolean = () => true
  ): Promise<"reconnected" | "stale" | "not_found" | "failed"> {
    const vault = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    if (!vault || !vaultPath || vault.vaultId !== binding.activeVaultId) return "stale";
    const snapshot = readSourceRecordSnapshot(vaultPath, binding.sourceId);
    if (!snapshot) return "not_found";
    const original = snapshot.record.original;
    if (
      snapshot.record.storageStrategy !== "reference_original" ||
      !original?.checksum || original.lastKnownSize === undefined
    ) return "stale";

    let canonicalPath: string;
    try {
      canonicalPath = canonicalRegularFile(selectedPath);
      const verified = await createVerifiedFileSnapshot({
        sourcePath: canonicalPath,
        expectedSize: original.lastKnownSize,
        expectedChecksum: original.checksum,
        unavailableCode: "source.external_unavailable",
        integrityCode: "source.checksum_mismatch"
      });
      await verified.dispose();
    } catch {
      return "failed";
    }

    const selectedStat = fs.statSync(canonicalPath);
    if (!assertCurrent()) return "stale";
    const updated = SourceRecordSchema.parse({
      ...snapshot.record,
      original: {
        ...original,
        uri: pathToFileURL(canonicalPath).href,
        path: canonicalPath,
        lastKnownMtime: selectedStat.mtime.toISOString(),
        lastKnownSize: selectedStat.size
      },
      updatedAt: new Date().toISOString()
    });
    try {
      replaceSourceRecord(vaultPath, snapshot, updated);
      const committed = readSourceRecordSnapshot(vaultPath, binding.sourceId);
      if (!committed || committed.record.original?.path !== canonicalPath ||
          !tryVerifyReadableSourceFile(vaultPath, committed.record)) {
        throw new PigeDomainError("source.reconnect_failed", "The reconnected source could not be verified after commit.");
      }
      return "reconnected";
    } catch (caught) {
      return caught instanceof PigeDomainError && caught.code === "source.reconnect_stale" ? "stale" : "failed";
    }
  }
}

function canonicalRegularFile(selectedPath: string): string {
  if (!path.isAbsolute(selectedPath) || selectedPath.includes("\0")) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source path is invalid.");
  }
  const resolved = path.resolve(selectedPath);
  const selectedStat = fs.lstatSync(resolved);
  if (!selectedStat.isFile() || selectedStat.isSymbolicLink() || selectedStat.nlink !== 1) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source is not a private regular file.");
  }
  const real = fs.realpathSync.native(resolved);
  const stat = fs.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new PigeDomainError("source.reconnect_invalid", "The selected source is not a private regular file.");
  }
  return resolved;
}

function readSourceRecordSnapshot(vaultPath: string, sourceId: string): SourceRecordSnapshot | undefined {
  const dateKey = /^src_(\d{8})_[a-z0-9]{8,}$/u.exec(sourceId)?.[1];
  if (!dateKey) return undefined;
  const root = path.join(vaultPath, ".pige", "source-records");
  const filePath = path.join(root, dateKey.slice(0, 4), dateKey.slice(4, 6), `${sourceId}.json`);
  assertConfinedFile(vaultPath, root, filePath);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw caught;
  }
  if (bytes.byteLength > 2 * 1024 * 1024) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record exceeds its read bound.");
  }
  const parsed = SourceRecordSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success || parsed.data.id !== sourceId) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record is invalid.");
  }
  return {
    filePath,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    record: parsed.data
  };
}

function replaceSourceRecord(vaultPath: string, expected: SourceRecordSnapshot, record: SourceRecord): void {
  const current = readSourceRecordSnapshot(vaultPath, record.id);
  if (!current || current.filePath !== expected.filePath || current.checksum !== expected.checksum) {
    throw new PigeDomainError("source.reconnect_stale", "The Source Record changed before reconnect commit.");
  }
  const directory = path.dirname(expected.filePath);
  const temporary = path.join(directory, `.${path.basename(expected.filePath)}.${randomUUID()}.tmp`);
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(descriptor, bytes, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const latest = readSourceRecordSnapshot(vaultPath, record.id);
    if (!latest || latest.checksum !== expected.checksum) {
      throw new PigeDomainError("source.reconnect_stale", "The Source Record changed during reconnect commit.");
    }
    fs.renameSync(temporary, expected.filePath);
    try {
      const directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    } catch {
      // Directory fsync is unavailable on some supported filesystems.
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* already committed */ }
  }
}

function assertConfinedFile(vaultPath: string, root: string, filePath: string): void {
  const vaultReal = fs.realpathSync.native(vaultPath);
  const relativeToRoot = path.relative(root, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record escapes its durable root.");
  }
  let current = vaultPath;
  for (const segment of path.relative(vaultPath, path.dirname(filePath)).split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new PigeDomainError("source.reconnect_invalid", "The Source Record parent is unsafe.");
    }
  }
  const parentReal = fs.realpathSync.native(path.dirname(filePath));
  if (parentReal !== vaultReal && !parentReal.startsWith(`${vaultReal}${path.sep}`)) {
    throw new PigeDomainError("source.reconnect_invalid", "The Source Record escapes the active vault.");
  }
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new PigeDomainError("source.reconnect_invalid", "The Source Record file is unsafe.");
    }
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}
