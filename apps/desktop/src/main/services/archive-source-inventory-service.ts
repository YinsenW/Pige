import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { CurrentSourceRecordSchema, SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { openPromise, validateFileName, type Entry } from "yauzl";

export const ARCHIVE_SOURCE_INVENTORY_ID = "archive_source_inventory";
export const ARCHIVE_SOURCE_INVENTORY_VERSION = "yauzl@3.4.0";

export function isArchiveSourceKind(sourceKind: string | undefined): boolean {
  return sourceKind === "archive";
}

export interface ArchiveSourceInventoryLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxEntryNameLength: number;
  readonly maxEntryDepth: number;
  readonly maxEntryBytes: number;
  readonly maxExpandedBytes: number;
  readonly maxCompressionRatio: number;
  readonly compressionRatioMinBytes: number;
}

export const DEFAULT_ARCHIVE_SOURCE_INVENTORY_LIMITS: ArchiveSourceInventoryLimits = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryNameLength: 1_024,
  maxEntryDepth: 32,
  maxEntryBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 1_000,
  compressionRatioMinBytes: 1024 * 1024
};

export interface ArchiveSourceInventoryRequest {
  readonly archivePath: string;
  readonly expectedChecksum?: string;
  readonly expectedSize?: number;
  readonly expectedMtimeMs?: number;
  readonly limits?: Partial<ArchiveSourceInventoryLimits>;
}

export interface ArchiveInventoryEntry {
  readonly ordinal: number;
  readonly locator: string;
  readonly relativePath: string;
  readonly kind: "file" | "directory";
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
}

export interface ArchiveSourceInventory {
  readonly schemaVersion: 1;
  readonly inventoryId: typeof ARCHIVE_SOURCE_INVENTORY_ID;
  readonly inventoryVersion: typeof ARCHIVE_SOURCE_INVENTORY_VERSION;
  readonly archiveChecksumBefore: string;
  readonly archiveChecksum: string;
  readonly archiveSize: number;
  readonly limitProfileDigest: string;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly entries: readonly ArchiveInventoryEntry[];
}

export interface PreparedArchiveSource {
  readonly sourceRecord: SourceRecord;
  readonly inventory: ArchiveSourceInventory;
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly artifactChecksum: string;
}

export async function ensureArchiveInventoryForExistingSource(input: {
  readonly vaultPath: string;
  readonly sourceRecordPath: string;
  readonly archivePath: string;
  readonly expectedChecksum: string;
  readonly expectedSize: number;
}): Promise<void> {
  const sourceRecordFile = resolveVaultRelativePath(input.vaultPath, input.sourceRecordPath);
  const parsed = SourceRecordSchema.safeParse(JSON.parse(fs.readFileSync(sourceRecordFile, "utf8")));
  if (!parsed.success || parsed.data.kind !== "archive") {
    throw archiveError("source.archive_binding_invalid", "The existing archive Source Record could not be revalidated.");
  }
  const metadata = parsed.data.metadata as Record<string, unknown>;
  const artifactId = typeof metadata.archiveInventoryArtifactId === "string"
    ? metadata.archiveInventoryArtifactId
    : undefined;
  const artifact = artifactId === undefined
    ? undefined
    : parsed.data.artifacts.find((candidate) => candidate.id === artifactId);
  if (
    metadata.archiveInventoryStatus === "ready" &&
    metadata.archiveInventoryChecksum === input.expectedChecksum &&
    typeof artifact?.path === "string" &&
    fs.existsSync(resolveVaultRelativePath(input.vaultPath, artifact.path))
  ) {
    return;
  }
  const prepared = await prepareArchiveSourceRecord({
    vaultPath: input.vaultPath,
    sourceRecord: parsed.data,
    archivePath: input.archivePath,
    expectedChecksum: input.expectedChecksum,
    expectedSize: input.expectedSize
  });
  writeArtifactAtomic(sourceRecordFile, Buffer.from(`${JSON.stringify(prepared.sourceRecord)}\n`, "utf8"));
}

export async function prepareArchiveSourceRecord(input: {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly archivePath: string;
  readonly expectedChecksum: string;
  readonly expectedSize: number;
}): Promise<PreparedArchiveSource> {
  if (input.sourceRecord.kind !== "archive") {
    throw archiveError("source.archive_binding_invalid", "The archive inventory binding is not an archive Source Record.");
  }
  const inventory = await inspectArchiveSource({
    archivePath: input.archivePath,
    expectedChecksum: input.expectedChecksum,
    expectedSize: input.expectedSize
  });
  const artifactId = `art_${input.sourceRecord.id.slice(4)}_archive_inventory`;
  const artifactPath = `artifacts/archive-inventory/${input.sourceRecord.id}.json`;
  const artifactBytes = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    artifactId,
    sourceId: input.sourceRecord.id,
    sourceRecordDigest: checksumBytes(Buffer.from(JSON.stringify(input.sourceRecord), "utf8")),
    inventory
  }, null, 2)}\n`, "utf8");
  const artifactChecksum = checksumBytes(artifactBytes);
  writeArtifactAtomic(resolveVaultRelativePath(input.vaultPath, artifactPath), artifactBytes);
  const now = new Date().toISOString();
  const sourceRecord = CurrentSourceRecordSchema.parse({
    ...input.sourceRecord,
    artifacts: [
      ...input.sourceRecord.artifacts.filter((artifact) => artifact.id !== artifactId),
      {
        id: artifactId,
        kind: "metadata",
        path: artifactPath,
        checksum: artifactChecksum,
        size: artifactBytes.byteLength
      }
    ],
    metadata: {
      ...input.sourceRecord.metadata,
      archiveInventoryStatus: "ready",
      archiveInventoryArtifactId: artifactId,
      archiveInventoryEntryCount: inventory.entryCount,
      archiveInventoryTotalUncompressedBytes: inventory.totalUncompressedBytes,
      archiveInventoryChecksum: inventory.archiveChecksum,
      archiveInventorySourceRecordDigest: checksumBytes(Buffer.from(JSON.stringify(input.sourceRecord), "utf8")),
      archiveInventoryLimitProfileDigest: inventory.limitProfileDigest,
      archiveInventoryVersion: inventory.inventoryVersion,
      parserStatus: "archive_inventory_ready",
      parserRequired: false
    },
    updatedAt: now
  });
  return { sourceRecord, inventory, artifactId, artifactPath, artifactChecksum };
}

export function archiveSourcePageCopy(metadata: Record<string, unknown>): {
  readonly summary: string;
  readonly keyPoint: string;
  readonly body: string;
  readonly section: string;
} | undefined {
  if (metadata.archiveInventoryStatus !== "ready") return undefined;
  const entryCount = metadata.archiveInventoryEntryCount;
  const expandedBytes = metadata.archiveInventoryTotalUncompressedBytes;
  if (!Number.isSafeInteger(entryCount) || !Number.isSafeInteger(expandedBytes)) return undefined;
  return {
    summary: "Pige preserved this ZIP archive and recorded a bounded local inventory without executing or expanding its contents.",
    keyPoint: `The archive inventory contains ${entryCount} bounded entries (${expandedBytes} expanded bytes) and is available for Agent inspection.`,
    body: "The ZIP archive is preserved as evidence. Its contents were not executed or copied into the source page.",
    section: `## Archive Inventory\n\n- Entries: ${entryCount}\n- Expanded bytes: ${expandedBytes}\n- Inventory is bounded, path-safe, local, and non-executing.\n`
  };
}

export async function inspectArchiveSource(
  request: ArchiveSourceInventoryRequest
): Promise<ArchiveSourceInventory> {
  const limits = { ...DEFAULT_ARCHIVE_SOURCE_INVENTORY_LIMITS, ...request.limits };
  const limitProfileDigest = checksumBytes(Buffer.from(JSON.stringify(limits), "utf8"));
  const before = await readArchiveStat(request.archivePath, limits, request.expectedSize, request.expectedMtimeMs);
  const checksumBefore = await checksumArchive(request.archivePath);
  if (request.expectedChecksum && checksumBefore !== request.expectedChecksum) {
    throw archiveError("source.archive_checksum_mismatch", "The selected archive changed before it could be inventoried.");
  }

  let zipFile: Awaited<ReturnType<typeof openPromise>> | undefined;
  try {
    zipFile = await openPromise(request.archivePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: false
    });
  } catch {
    throw archiveError("source.archive_invalid", "The selected archive is not a valid ZIP file.");
  }

  try {
    try {
      if (zipFile.entryCount > limits.maxEntries) {
        throw archiveError("source.archive_too_many_entries", "The selected archive exceeds the entry limit.");
      }
      const entries: ArchiveInventoryEntry[] = [];
      const seen = new Set<string>();
      let totalUncompressedBytes = 0;
      let ordinal = 0;
      for await (const entry of zipFile.eachEntry()) {
        ordinal += 1;
        if (ordinal > limits.maxEntries) {
          throw archiveError("source.archive_too_many_entries", "The selected archive exceeds the entry limit.");
        }
        const relativePath = validateArchiveEntry(entry, limits);
        if (seen.has(relativePath)) {
          throw archiveError("source.archive_duplicate_entry", "The selected archive contains duplicate entry names.");
        }
        seen.add(relativePath);
        totalUncompressedBytes += entry.uncompressedSize;
        if (totalUncompressedBytes > limits.maxExpandedBytes) {
          throw archiveError("source.archive_expanded_too_large", "The selected archive exceeds the expanded-byte limit.");
        }
        entries.push({
          ordinal,
          locator: `archive:entry:${ordinal}`,
          relativePath,
          kind: isDirectoryEntry(entry) ? "directory" : "file",
          compressedBytes: entry.compressedSize,
          uncompressedBytes: entry.uncompressedSize
        });
      }

      const after = await readArchiveStat(request.archivePath, limits, request.expectedSize, request.expectedMtimeMs);
      const checksumAfter = await checksumArchive(request.archivePath);
      if (
        after.dev !== before.dev ||
        after.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        checksumAfter !== checksumBefore
      ) {
        throw archiveError("source.archive_changed", "The selected archive changed while it was inventoried.");
      }
      return {
        schemaVersion: 1,
        inventoryId: ARCHIVE_SOURCE_INVENTORY_ID,
        inventoryVersion: ARCHIVE_SOURCE_INVENTORY_VERSION,
        archiveChecksumBefore: checksumBefore,
        archiveChecksum: checksumAfter,
        archiveSize: after.size,
        limitProfileDigest,
        entryCount: entries.length,
        totalUncompressedBytes,
        entries
      };
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      if (caught instanceof Error && /invalid relative path|unsafe file name/iu.test(caught.message)) {
        throw archiveError("source.archive_unsafe_entry", "The selected archive contains an unsafe entry path.");
      }
      throw archiveError("source.archive_invalid", "The selected archive could not be inventoried safely.");
    }
  } finally {
    zipFile.close();
  }
}

interface ArchiveStat {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
}

async function readArchiveStat(
  archivePath: string,
  limits: ArchiveSourceInventoryLimits,
  expectedSize: number | undefined,
  expectedMtimeMs: number | undefined
): Promise<ArchiveStat> {
  const stat = await fs.promises.lstat(archivePath).catch(() => undefined);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
    throw archiveError("source.archive_unavailable", "The selected archive is unavailable or is not a regular file.");
  }
  if (!Number.isSafeInteger(stat.size) || stat.size > limits.maxArchiveBytes) {
    throw archiveError("source.archive_too_large", "The selected archive exceeds the file-size limit.");
  }
  if (expectedSize !== undefined && stat.size !== expectedSize) {
    throw archiveError("source.archive_checksum_mismatch", "The selected archive size no longer matches its captured identity.");
  }
  if (expectedMtimeMs !== undefined && stat.mtimeMs !== expectedMtimeMs) {
    throw archiveError("source.archive_changed", "The selected archive modification time no longer matches its captured identity.");
  }
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
}

async function checksumArchive(archivePath: string): Promise<string> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of fs.createReadStream(archivePath, { highWaterMark: 1024 * 1024 })) {
      hash.update(chunk as Buffer);
    }
  } catch {
    throw archiveError("source.archive_unavailable", "The selected archive could not be read.");
  }
  return `sha256:${hash.digest("hex")}`;
}

function checksumBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validateArchiveEntry(entry: Entry, limits: ArchiveSourceInventoryLimits): string {
  const name = entry.fileName;
  const invalidName = validateFileName(name);
  const normalizedName = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = normalizedName.split("/");
  if (
    invalidName ||
    name.length === 0 ||
    name.length > limits.maxEntryNameLength ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    path.posix.isAbsolute(name) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    path.posix.normalize(name) !== name ||
    segments.length > limits.maxEntryDepth
  ) {
    throw archiveError("source.archive_unsafe_entry", "The selected archive contains an unsafe entry path.");
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if ((unixMode & 0o170000) === 0o120000) {
    throw archiveError("source.archive_link_entry", "The selected archive contains a symbolic link entry.");
  }
  if (
    !Number.isSafeInteger(entry.compressedSize) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.compressedSize < 0 ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > limits.maxEntryBytes
  ) {
    throw archiveError("source.archive_entry_too_large", "An archive entry exceeds the per-entry limit.");
  }
  if (entry.compressedSize === 0 && entry.uncompressedSize > 0) {
    throw archiveError("source.archive_zero_compressed", "The selected archive contains a non-empty zero-compressed entry.");
  }
  if (entry.isEncrypted()) {
    throw archiveError("source.archive_encrypted", "Encrypted archives are not supported.");
  }
  if (!entry.canDecodeFileData()) {
    throw archiveError("source.archive_unsupported_compression", "The archive uses an unsupported compression method.");
  }
  if (
    entry.uncompressedSize >= limits.compressionRatioMinBytes &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio)
  ) {
    throw archiveError("source.archive_suspicious_compression", "The archive contains an entry with a suspicious compression ratio.");
  }
  return name;
}

function isDirectoryEntry(entry: Entry): boolean {
  return entry.fileName.endsWith("/") || Boolean(entry.externalFileAttributes & 0x10);
}

function archiveError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const vaultRoot = path.resolve(vaultPath);
  const resolved = path.resolve(vaultRoot, ...relativePath.split("/"));
  if (resolved !== vaultRoot && !resolved.startsWith(`${vaultRoot}${path.sep}`)) {
    throw archiveError("source.archive_path_outside_vault", "The archive inventory artifact path is outside the active vault.");
  }
  return resolved;
}

function writeArtifactAtomic(filePath: string, bytes: Buffer): void {
  const directoryPath = path.dirname(filePath);
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    const directory = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}
