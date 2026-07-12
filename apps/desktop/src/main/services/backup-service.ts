import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { openPromise, validateFileName, type Entry } from "yauzl";
import { ZipFile } from "yazl";
import type {
  BackupCreateResult,
  BackupManifestSummary,
  BackupRestoreStatus,
  RestoreApplyResult,
  RestorePreviewResult,
  VaultSummary
} from "@pige/contracts";
import { PIGE_APP_MIN_VERSION, PigeDomainError } from "@pige/domain";
import {
  PIGE_DURABLE_ROOTS,
  PIGE_REBUILDABLE_ROOTS,
  isPigeVault,
  normalizeVaultName,
  readVaultManifest
} from "./vault-layout";

interface BackupManifestFile {
  readonly path: string;
  readonly size: number;
  readonly checksum: string;
}

interface BackupManifest {
  readonly format: "pige-backup";
  readonly formatVersion: 1;
  readonly appVersion: string;
  readonly vaultId: string;
  readonly vaultName: string;
  readonly vaultSchemaVersion: number;
  readonly createdAt: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly noteCount: number;
  readonly sourceCount: number;
  readonly conversationCount: number;
  readonly memoryCount: number;
  readonly includesSecrets: false;
  readonly includes: BackupRestoreStatus["defaultIncludes"];
  readonly excludedRoots: readonly string[];
  readonly externalDependencies: readonly string[];
  readonly files: readonly BackupManifestFile[];
}

const BACKUP_FORMAT = "pige-backup";
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_MANIFEST_FILE = "pige-backup-manifest.json";
const BACKUP_VAULT_DIR = "vault";
const DEFAULT_INCLUDES: BackupRestoreStatus["defaultIncludes"] = {
  markdownKnowledge: true,
  sourceRecords: true,
  managedSourceCopies: true,
  conversations: true,
  vaultMemory: true,
  trash: true,
  rebuildableDatabaseCache: false,
  secrets: false
};

const ROOT_FILES = ["PIGE.md", "index.md", "log.md", ".pige/manifest.json", ".pige/config.json"] as const;

export class BackupRestoreService {
  status(activeVault: VaultSummary | undefined): BackupRestoreStatus {
    return {
      phase: "available",
      createAvailable: Boolean(activeVault),
      restoreAvailable: true,
      ...(activeVault?.lastBackupAt ? { lastBackupAt: activeVault.lastBackupAt } : {}),
      messageKey: activeVault ? "backup.statusReady" : "backup.statusNoVault",
      defaultIncludes: DEFAULT_INCLUDES
    };
  }

  async createBackup(
    vaultPathInput: string,
    backupFilePathInput: string,
    appVersion = PIGE_APP_MIN_VERSION
  ): Promise<BackupCreateResult> {
    const vaultPath = path.resolve(vaultPathInput);
    const backupFilePath = normalizeBackupFilePath(backupFilePathInput);
    if (!isPigeVault(vaultPath)) {
      throw new PigeDomainError("backup.vault_invalid", "Active vault is not a compatible Pige vault.");
    }
    if (isSameOrInside(backupFilePath, vaultPath)) {
      throw new PigeDomainError("backup.path_inside_vault", "Backup file cannot be created inside the active vault.");
    }
    fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
    reconcilePublishedBackupStagingLinks(backupFilePath);
    if (fs.existsSync(backupFilePath)) {
      throw new PigeDomainError("backup.destination_exists", "Backup file already exists.");
    }

    const manifest = createBackupManifest(vaultPath, appVersion);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const stagingPath = createBackupStagingPath(backupFilePath);
    let descriptor: number | undefined;
    let stagingIdentity: fs.Stats | undefined;
    let linkedDestination = false;
    let finalized = false;

    try {
      const flags = fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0);
      descriptor = fs.openSync(stagingPath, flags, 0o600);
      const openedStat = fs.fstatSync(descriptor);
      const openedPathStat = fs.lstatSync(stagingPath);
      if (
        openedStat.nlink !== 1 ||
        openedPathStat.nlink !== 1 ||
        !sameFileIdentity(openedStat, openedPathStat)
      ) {
        throw new PigeDomainError("backup.staging_changed", "Backup staging archive is not private.");
      }
      stagingIdentity = openedStat;

      const zipFile = new ZipFile();
      zipFile.addBuffer(
        Buffer.from(manifestText, "utf8"),
        BACKUP_MANIFEST_FILE,
        { mtime: new Date(manifest.createdAt) }
      );
      for (const file of manifest.files) {
        const sourcePath = path.join(vaultPath, ...file.path.split("/"));
        zipFile.addFile(sourcePath, `${BACKUP_VAULT_DIR}/${file.path}`, {
          mtime: fs.statSync(sourcePath).mtime
        });
      }
      zipFile.end();

      await pipeline(
        zipFile.outputStream,
        fs.createWriteStream(stagingPath, { fd: descriptor, autoClose: false })
      );
      fs.fsyncSync(descriptor);
      const writtenStat = fs.fstatSync(descriptor);
      const writtenPathStat = fs.lstatSync(stagingPath);
      if (
        writtenStat.nlink !== 1 ||
        writtenPathStat.nlink !== 1 ||
        !sameInodeIdentity(openedStat, writtenStat) ||
        !sameFileIdentity(writtenStat, writtenPathStat)
      ) {
        throw new PigeDomainError("backup.staging_changed", "Backup staging archive changed while it was written.");
      }
      stagingIdentity = writtenStat;
      fs.closeSync(descriptor);
      descriptor = undefined;

      const stagedManifestText = await readZipTextEntry(stagingPath, BACKUP_MANIFEST_FILE);
      if (stagedManifestText !== manifestText) {
        throw new PigeDomainError("backup.validation_failed", "Staged backup manifest does not match the source snapshot.");
      }
      parseBackupManifest(JSON.parse(stagedManifestText) as unknown);
      const validation = await validateBackupZip(stagingPath, manifest);
      if (validation.invalidFiles.length > 0) {
        throw new PigeDomainError("backup.validation_failed", "Staged backup files failed validation.");
      }
      const validatedPathStat = fs.lstatSync(stagingPath);
      if (validatedPathStat.nlink !== 1 || !sameFileRevision(stagingIdentity, validatedPathStat)) {
        throw new PigeDomainError("backup.staging_changed", "Backup staging archive changed during validation.");
      }
      const stagedArchiveChecksum = checksumFile(stagingPath);

      const result: BackupCreateResult = {
        status: "created",
        backupPath: backupFilePath,
        manifest: toManifestSummary(manifest)
      };

      try {
        fs.linkSync(stagingPath, backupFilePath);
        linkedDestination = true;
      } catch (caught) {
        if (isErrno(caught, "EEXIST")) {
          throw new PigeDomainError("backup.destination_exists", "Backup file already exists.");
        }
        if (isAtomicLinkUnsupported(caught)) {
          throw new PigeDomainError(
            "backup.atomic_publish_unsupported",
            "The selected destination does not support atomic backup publication."
          );
        }
        if (isAtomicLinkDenied(caught)) {
          throw new PigeDomainError(
            "backup.destination_not_writable",
            "The selected destination does not permit atomic backup publication."
          );
        }
        throw caught;
      }

      const linkedStagingStat = fs.lstatSync(stagingPath);
      const linkedDestinationStat = fs.lstatSync(backupFilePath);
      if (
        linkedStagingStat.nlink !== 2 ||
        linkedDestinationStat.nlink !== 2 ||
        !sameFileDataRevision(stagingIdentity, linkedStagingStat) ||
        !sameFileDataRevision(linkedStagingStat, linkedDestinationStat) ||
        checksumFile(backupFilePath) !== stagedArchiveChecksum
      ) {
        throw new PigeDomainError("backup.finalization_failed", "Backup archive changed during finalization.");
      }
      fsyncDirectoryIfSupported(path.dirname(backupFilePath));
      fs.rmSync(stagingPath);
      const finalizedStat = fs.lstatSync(backupFilePath);
      if (finalizedStat.nlink !== 1 || !sameFileDataRevision(linkedDestinationStat, finalizedStat)) {
        throw new PigeDomainError("backup.finalization_failed", "Backup archive did not finalize privately.");
      }
      finalized = true;
      fsyncDirectoryBestEffort(path.dirname(backupFilePath));
      return result;
    } finally {
      if (descriptor !== undefined) {
        try {
          stagingIdentity ??= fs.fstatSync(descriptor);
        } catch {
          // Cleanup below remains limited to the unique staging path.
        }
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the primary backup result.
        }
      }
      if (!finalized && linkedDestination && stagingIdentity) {
        removeOwnedFile(backupFilePath, stagingIdentity);
      }
      if (stagingIdentity) {
        removeOwnedFile(stagingPath, stagingIdentity);
      }
    }
  }

  async previewRestore(backupPathInput: string): Promise<RestorePreviewResult> {
    const backupPath = path.resolve(backupPathInput);
    const manifest = await readBackupManifest(backupPath);
    const validation = await validateBackupZip(backupPath, manifest);
    return {
      status: "ready",
      backupPath,
      manifest: toManifestSummary(manifest),
      invalidFileCount: validation.invalidFiles.length,
      warnings: createPreviewWarnings(manifest, validation.invalidFiles)
    };
  }

  async applyRestore(backupPathInput: string, restoreParentDirectoryInput: string): Promise<RestoreApplyResult> {
    const backupPath = path.resolve(backupPathInput);
    const restoreParentDirectory = path.resolve(restoreParentDirectoryInput);
    const manifest = await readBackupManifest(backupPath);
    const validation = await validateBackupZip(backupPath, manifest);
    if (validation.invalidFiles.length > 0) {
      throw new PigeDomainError("restore.backup_invalid", "Backup files failed validation.");
    }

    const restoredVaultPath = path.join(restoreParentDirectory, normalizeVaultName(`${manifest.vaultName} Restored`));
    if (fs.existsSync(restoredVaultPath)) {
      throw new PigeDomainError("restore.destination_exists", "Restore destination already exists.");
    }
    fs.mkdirSync(restoreParentDirectory, { recursive: true });
    const stagingPath = fs.mkdtempSync(path.join(restoreParentDirectory, ".pige-restore-"));

    try {
      await extractBackupVault(backupPath, manifest, stagingPath);
      for (const rebuildableRoot of PIGE_REBUILDABLE_ROOTS) {
        fs.mkdirSync(path.join(stagingPath, rebuildableRoot), { recursive: true });
      }
      if (!isPigeVault(stagingPath)) {
        throw new PigeDomainError("restore.result_invalid", "Restored folder is not a compatible Pige vault.");
      }
      fs.renameSync(stagingPath, restoredVaultPath);
    } catch (caught) {
      fs.rmSync(stagingPath, { recursive: true, force: true });
      fs.rmSync(restoredVaultPath, { recursive: true, force: true });
      throw caught;
    }

    return {
      status: "restored",
      restoredVaultPath,
      manifest: toManifestSummary(manifest)
    };
  }
}

function createBackupManifest(vaultPath: string, appVersion: string): BackupManifest {
  const vaultManifest = readVaultManifest(vaultPath);
  const createdAt = new Date().toISOString();
  const files = collectBackupFiles(vaultPath).map((relativePath) => {
    const absolutePath = path.join(vaultPath, ...relativePath.split("/"));
    const snapshot = snapshotBackupSourceFile(absolutePath);
    return {
      path: relativePath,
      size: snapshot.size,
      checksum: snapshot.checksum
    };
  });
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    vaultId: vaultManifest.vault_id,
    vaultName: path.basename(vaultPath),
    vaultSchemaVersion: vaultManifest.vault_schema_version,
    createdAt,
    fileCount: files.length,
    totalBytes,
    noteCount: countFiles(path.join(vaultPath, "wiki"), (filePath) => filePath.endsWith(".md")),
    sourceCount: countFiles(path.join(vaultPath, "sources"), (filePath) => filePath.endsWith(".md")),
    conversationCount: countFiles(path.join(vaultPath, ".pige/conversations")),
    memoryCount: countFiles(path.join(vaultPath, ".pige/memory")),
    includesSecrets: false,
    includes: DEFAULT_INCLUDES,
    excludedRoots: [...PIGE_REBUILDABLE_ROOTS],
    externalDependencies: [],
    files
  };
}

function collectBackupFiles(vaultPath: string): readonly string[] {
  const files = new Set<string>();
  for (const rootFile of ROOT_FILES) {
    const absolute = path.join(vaultPath, rootFile);
    if (isBackupFileCandidate(absolute)) files.add(rootFile);
  }

  for (const root of PIGE_DURABLE_ROOTS) {
    const absoluteRoot = path.join(vaultPath, root);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const file of walkFiles(absoluteRoot)) {
      files.add(path.relative(vaultPath, file).split(path.sep).join("/"));
    }
  }

  for (const excludedRoot of PIGE_REBUILDABLE_ROOTS) {
    const excludedPrefix = `${excludedRoot}/`;
    for (const file of Array.from(files)) {
      if (file === excludedRoot || file.startsWith(excludedPrefix)) files.delete(file);
    }
  }

  return Array.from(files).sort();
}

function walkFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (entry.isFile() && isBackupFileCandidate(absolute)) {
      files.push(absolute);
    }
  }
  return files;
}

function isBackupFileCandidate(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function readBackupManifest(backupPath: string): Promise<BackupManifest> {
  const manifestText = await readZipTextEntry(backupPath, BACKUP_MANIFEST_FILE);
  if (!manifestText) {
    throw new PigeDomainError("restore.manifest_missing", "Backup manifest is missing.");
  }
  return parseBackupManifest(JSON.parse(manifestText) as unknown);
}

function parseBackupManifest(value: unknown): BackupManifest {
  if (
    !isRecord(value) ||
    value.format !== BACKUP_FORMAT ||
    value.formatVersion !== BACKUP_FORMAT_VERSION ||
    !Array.isArray(value.files)
  ) {
    throw new PigeDomainError("restore.manifest_invalid", "Backup manifest is not compatible.");
  }
  const manifest = value as Partial<BackupManifest>;
  if (
    typeof manifest.vaultId !== "string" ||
    typeof manifest.vaultName !== "string" ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.appVersion !== "string" ||
    typeof manifest.vaultSchemaVersion !== "number"
  ) {
    throw new PigeDomainError("restore.manifest_invalid", "Backup manifest is incomplete.");
  }
  const files = manifest.files ?? [];
  const manifestPaths = new Set<string>();
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.size !== "number" || typeof file.checksum !== "string") {
      throw new PigeDomainError("restore.manifest_invalid", "Backup manifest contains invalid file entries.");
    }
    assertSafeVaultRelativePath(file.path);
    if (manifestPaths.has(file.path)) {
      throw new PigeDomainError("restore.entry_duplicate", "Backup manifest contains duplicate file entries.");
    }
    manifestPaths.add(file.path);
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: manifest.appVersion,
    vaultId: manifest.vaultId,
    vaultName: manifest.vaultName,
    vaultSchemaVersion: manifest.vaultSchemaVersion,
    createdAt: manifest.createdAt,
    fileCount: files.length,
    totalBytes: typeof manifest.totalBytes === "number" ? manifest.totalBytes : 0,
    noteCount: typeof manifest.noteCount === "number" ? manifest.noteCount : 0,
    sourceCount: typeof manifest.sourceCount === "number" ? manifest.sourceCount : 0,
    conversationCount: typeof manifest.conversationCount === "number" ? manifest.conversationCount : 0,
    memoryCount: typeof manifest.memoryCount === "number" ? manifest.memoryCount : 0,
    includesSecrets: false,
    includes: manifest.includes ?? DEFAULT_INCLUDES,
    excludedRoots: Array.isArray(manifest.excludedRoots) ? manifest.excludedRoots.filter((entry): entry is string => typeof entry === "string") : [],
    externalDependencies: Array.isArray(manifest.externalDependencies)
      ? manifest.externalDependencies.filter((entry): entry is string => typeof entry === "string")
      : [],
    files
  };
}

async function readZipTextEntry(backupPath: string, entryName: string): Promise<string | undefined> {
  const zipFile = await openPromise(backupPath, { lazyEntries: false, validateEntrySizes: true, strictFileNames: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      if (entry.fileName !== entryName) continue;
      const buffer = await readZipEntryBuffer(zipFile, entry);
      return buffer.toString("utf8");
    }
  } finally {
    zipFile.close();
  }
  return undefined;
}

async function validateBackupZip(
  backupPath: string,
  manifest: BackupManifest
): Promise<{ readonly invalidFiles: readonly string[] }> {
  const invalidFiles = new Set<string>();
  const manifestFilesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const seenManifestFiles = new Set<string>();
  const seenEntryNames = new Set<string>();
  let manifestEntryCount = 0;
  const zipFile = await openPromise(backupPath, { lazyEntries: false, validateEntrySizes: true, strictFileNames: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      if (seenEntryNames.has(entry.fileName)) {
        throw new PigeDomainError("restore.entry_duplicate", "Backup contains duplicate ZIP entries.");
      }
      seenEntryNames.add(entry.fileName);
      if (entry.fileName === BACKUP_MANIFEST_FILE) {
        manifestEntryCount += 1;
        continue;
      }
      if (entry.fileName.endsWith("/")) continue;
      const relativePath = toVaultRelativeEntryPath(entry.fileName);
      const manifestFile = manifestFilesByPath.get(relativePath);
      if (!manifestFile) {
        invalidFiles.add(relativePath);
        continue;
      }
      seenManifestFiles.add(relativePath);
      if (entry.uncompressedSize !== manifestFile.size) {
        invalidFiles.add(relativePath);
        continue;
      }
      const checksum = await checksumZipEntry(zipFile, entry);
      if (checksum !== manifestFile.checksum) invalidFiles.add(relativePath);
    }
  } finally {
    zipFile.close();
  }

  for (const file of manifest.files) {
    if (!seenManifestFiles.has(file.path)) invalidFiles.add(file.path);
  }
  if (manifestEntryCount !== 1) {
    throw new PigeDomainError("restore.manifest_invalid", "Backup must contain exactly one manifest entry.");
  }

  return { invalidFiles: Array.from(invalidFiles).sort() };
}

async function extractBackupVault(backupPath: string, manifest: BackupManifest, stagingPath: string): Promise<void> {
  const manifestFiles = new Set(manifest.files.map((file) => file.path));
  const zipFile = await openPromise(backupPath, { lazyEntries: false, validateEntrySizes: true, strictFileNames: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      if (entry.fileName === BACKUP_MANIFEST_FILE || entry.fileName.endsWith("/")) continue;
      const relativePath = toVaultRelativeEntryPath(entry.fileName);
      if (!manifestFiles.has(relativePath)) {
        throw new PigeDomainError("restore.entry_unexpected", "Backup contains an unexpected vault entry.");
      }
      const targetPath = resolveRestoreTarget(stagingPath, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      await pipeline(await zipFile.openReadStreamPromise(entry), fs.createWriteStream(targetPath, { flags: "wx" }));
    }
  } finally {
    zipFile.close();
  }
}

function toManifestSummary(manifest: BackupManifest): BackupManifestSummary {
  return {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    appVersion: manifest.appVersion,
    vaultId: manifest.vaultId,
    vaultName: manifest.vaultName,
    vaultSchemaVersion: manifest.vaultSchemaVersion,
    createdAt: manifest.createdAt,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    noteCount: manifest.noteCount,
    sourceCount: manifest.sourceCount,
    conversationCount: manifest.conversationCount,
    memoryCount: manifest.memoryCount,
    includesSecrets: false,
    includes: manifest.includes
  };
}

async function checksumZipEntry(zipFile: { openReadStreamPromise: (entry: Entry) => Promise<NodeJS.ReadableStream> }, entry: Entry): Promise<string> {
  const hash = createHash("sha256");
  const stream = await zipFile.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readZipEntryBuffer(zipFile: { openReadStreamPromise: (entry: Entry) => Promise<NodeJS.ReadableStream> }, entry: Entry): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = await zipFile.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function checksumFile(filePath: string): string {
  const hash = createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return `sha256:${hash.digest("hex")}`;
}

function snapshotBackupSourceFile(filePath: string): { readonly size: number; readonly checksum: string } {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor);
    const pathBefore = fs.lstatSync(filePath);
    if (
      before.nlink !== 1 ||
      pathBefore.nlink !== 1 ||
      !sameFileRevision(before, pathBefore)
    ) {
      throw new PigeDomainError("backup.source_changed", "A backup source file changed before it could be read.");
    }

    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);

    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (
      after.nlink !== 1 ||
      pathAfter.nlink !== 1 ||
      !sameFileRevision(before, after) ||
      !sameFileRevision(after, pathAfter)
    ) {
      throw new PigeDomainError("backup.source_changed", "A backup source file changed while it was read.");
    }
    return { size: after.size, checksum: `sha256:${hash.digest("hex")}` };
  } finally {
    fs.closeSync(descriptor);
  }
}

function countFiles(directory: string, predicate: (filePath: string) => boolean = () => true): number {
  if (!fs.existsSync(directory)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      count += countFiles(absolutePath, predicate);
    } else if (entry.isFile() && predicate(absolutePath)) {
      count += 1;
    }
  }
  return count;
}

function createPreviewWarnings(manifest: BackupManifest, invalidFiles: readonly string[]): readonly string[] {
  return [
    ...invalidFiles.map((file) => `Checksum, size, or manifest mismatch: ${file}`),
    ...(manifest.excludedRoots.length > 0 ? [`Excluded rebuildable roots: ${manifest.excludedRoots.join(", ")}`] : []),
    ...(manifest.externalDependencies.length > 0
      ? [`External originals are referenced but not included: ${manifest.externalDependencies.length}`]
      : [])
  ];
}

function normalizeBackupFilePath(filePathInput: string): string {
  const resolved = path.resolve(filePathInput);
  if (resolved.endsWith(".pige-backup.zip")) return resolved;
  if (resolved.endsWith(".zip")) return `${resolved.slice(0, -4)}.pige-backup.zip`;
  return `${resolved}.pige-backup.zip`;
}

function createBackupStagingPath(backupFilePath: string): string {
  return path.join(
    path.dirname(backupFilePath),
    `.${path.basename(backupFilePath)}.${process.pid}.${randomUUID()}.tmp`
  );
}

function reconcilePublishedBackupStagingLinks(backupFilePath: string): void {
  let destinationStat: fs.Stats;
  try {
    destinationStat = fs.lstatSync(backupFilePath);
  } catch {
    return;
  }
  if (!destinationStat.isFile() || destinationStat.isSymbolicLink() || destinationStat.nlink < 2) return;

  const directoryPath = path.dirname(backupFilePath);
  const stagingPrefix = `.${path.basename(backupFilePath)}.`;
  for (const entryName of fs.readdirSync(directoryPath)) {
    if (!entryName.startsWith(stagingPrefix) || !entryName.endsWith(".tmp")) continue;
    const ownerPid = parseBackupStagingOwnerPid(entryName, stagingPrefix);
    if (ownerPid === undefined || isProcessPossiblyAlive(ownerPid)) continue;
    const stagingPath = path.join(directoryPath, entryName);
    try {
      const stagingStat = fs.lstatSync(stagingPath);
      if (
        stagingStat.nlink === destinationStat.nlink &&
        sameFileDataRevision(destinationStat, stagingStat)
      ) {
        fs.rmSync(stagingPath);
      }
    } catch {
      // Keep uncertain files for explicit recovery rather than deleting by name.
    }
  }
}

function parseBackupStagingOwnerPid(entryName: string, stagingPrefix: string): number | undefined {
  const suffix = entryName.slice(stagingPrefix.length, -".tmp".length);
  const match = /^(\d+)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(suffix);
  if (!match?.[1]) return undefined;
  const ownerPid = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : undefined;
}

function isProcessPossiblyAlive(ownerPid: number): boolean {
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (caught) {
    return !isErrno(caught, "ESRCH");
  }
}

function removeOwnedFile(filePath: string, identity: fs.Stats): void {
  try {
    const current = fs.lstatSync(filePath);
    if (!current.isSymbolicLink() && sameInodeIdentity(identity, current)) {
      fs.rmSync(filePath);
    }
  } catch {
    // Never remove a path whose identity cannot be proven to belong to this invocation.
  }
}

function fsyncDirectoryIfSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFsync(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function fsyncDirectoryBestEffort(directoryPath: string): void {
  try {
    fsyncDirectoryIfSupported(directoryPath);
  } catch {
    // The fully validated destination already exists; a later retry reconciles a resurrected staging link.
  }
}

function isUnsupportedDirectoryFsync(caught: unknown): boolean {
  if (!isRecord(caught) || !("code" in caught)) return false;
  const code = String(caught.code);
  const portableUnsupported = ["EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"];
  return portableUnsupported.includes(code) || (process.platform === "win32" && ["EBADF", "EPERM"].includes(code));
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size;
}

function sameInodeIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameFileIdentity(left, right) && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function sameFileDataRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameFileIdentity(left, right) && left.mtimeMs === right.mtimeMs;
}

function toVaultRelativeEntryPath(entryName: string): string {
  if (!entryName.startsWith(`${BACKUP_VAULT_DIR}/`)) {
    throw new PigeDomainError("restore.entry_invalid", "Backup entry is outside the vault folder.");
  }
  const relativePath = entryName.slice(BACKUP_VAULT_DIR.length + 1);
  assertSafeVaultRelativePath(relativePath);
  return relativePath;
}

function assertSafeZipEntryName(entryName: string): void {
  if (validateFileName(entryName) !== null || entryName.includes("\0")) {
    throw new PigeDomainError("restore.entry_invalid", "Backup contains an unsafe ZIP entry name.");
  }
  if (entryName === BACKUP_MANIFEST_FILE) return;
  toVaultRelativeEntryPath(entryName);
}

function assertSafeVaultRelativePath(relativePath: string): void {
  const normalized = path.posix.normalize(relativePath);
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[A-Za-z]:/u.test(relativePath) ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized !== relativePath
  ) {
    throw new PigeDomainError("restore.entry_invalid", "Backup manifest contains an unsafe path.");
  }
}

function resolveRestoreTarget(stagingPath: string, relativePath: string): string {
  assertSafeVaultRelativePath(relativePath);
  const targetPath = path.resolve(stagingPath, ...relativePath.split("/"));
  if (!isSameOrInside(targetPath, stagingPath)) {
    throw new PigeDomainError("restore.entry_invalid", "Backup entry would write outside the restore folder.");
  }
  return targetPath;
}

function isSameOrInside(candidateInput: string, parentInput: string): boolean {
  const candidate = path.resolve(candidateInput);
  const parent = path.resolve(parentInput);
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}

function isAtomicLinkUnsupported(value: unknown): boolean {
  return ["EXDEV", "ENOSYS", "ENOTSUP", "EOPNOTSUPP"]
    .some((code) => isErrno(value, code));
}

function isAtomicLinkDenied(value: unknown): boolean {
  return ["EACCES", "EPERM", "EROFS"].some((code) => isErrno(value, code));
}
