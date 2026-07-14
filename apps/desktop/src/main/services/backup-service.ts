import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  RandomAccessReader,
  fromRandomAccessReaderPromise,
  openPromise,
  validateFileName,
  type Entry
} from "yauzl";
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
  PIGE_TRANSIENT_RUNTIME_ROOTS,
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

interface RestoreArchiveSnapshot {
  readonly size: number;
  readonly checksum: string;
  readonly revision: fs.Stats;
}

interface RestoreArchiveHandle {
  readonly path: string;
  readonly descriptor: number;
  readonly initialSnapshot: RestoreArchiveSnapshot;
}

interface RestorePublicationReservation {
  readonly identityVersion: 1;
  readonly previewToken: string;
  readonly reservationId: string;
}

interface RestorePublicationHandle {
  readonly reservation: RestorePublicationReservation;
  readonly sidecarPath: string;
  readonly sidecarIdentity: fs.Stats;
  readonly destinationPath: string;
  readonly destinationIdentity: fs.Stats;
  readonly markerPath?: string;
  readonly markerIdentity?: fs.Stats;
  readonly alreadyCommitted: boolean;
}

interface RestoreStagingHandle {
  readonly path: string;
  readonly identity: fs.Stats;
  readonly markerPath: string;
  readonly markerIdentity: fs.Stats;
  readonly markerBody: string;
}

const BACKUP_FORMAT = "pige-backup";
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_MANIFEST_FILE = "pige-backup-manifest.json";
const BACKUP_VAULT_DIR = "vault";
const RESTORE_COMMIT_ENTRY = ".pige/manifest.json";
const RESTORE_PUBLICATION_MARKER = ".pige-restore-publication.json";
const RESTORE_STAGING_MARKER = ".pige-restore-staging-owner";
const RESTORE_PREVIEW_TOKEN = /^sha256:[a-f0-9]{64}$/u;
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
    const archive = openRestoreArchive(backupPath);
    try {
      const manifest = await readBackupManifest(archive.descriptor);
      const validation = await validateBackupZip(archive.descriptor, manifest);
      const snapshotAfterValidation = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        archive.initialSnapshot,
        snapshotAfterValidation,
        "The backup changed while its restore preview was created."
      );
      return {
        status: "ready",
        backupPath,
        previewToken: createRestorePreviewToken(backupPath, snapshotAfterValidation),
        manifest: toManifestSummary(manifest),
        invalidFileCount: validation.invalidFiles.length,
        warnings: createPreviewWarnings(manifest, validation.invalidFiles)
      };
    } finally {
      fs.closeSync(archive.descriptor);
    }
  }

  async applyRestore(
    backupPathInput: string,
    restoreParentDirectoryInput: string,
    previewToken: string
  ): Promise<RestoreApplyResult> {
    const backupPath = path.resolve(backupPathInput);
    const restoreParentDirectory = path.resolve(restoreParentDirectoryInput);
    assertRestorePreviewToken(previewToken);
    const archive = openRestoreArchive(backupPath);
    let staging: RestoreStagingHandle | undefined;
    try {
      assertRestorePreviewMatches(backupPath, archive.initialSnapshot, previewToken);
      const manifest = await readBackupManifest(archive.descriptor);
      const validation = await validateBackupZip(archive.descriptor, manifest);
      const snapshotAfterValidation = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        archive.initialSnapshot,
        snapshotAfterValidation,
        "The backup changed after its restore preview."
      );
      assertRestorePreviewMatches(backupPath, snapshotAfterValidation, previewToken);
      if (validation.invalidFiles.length > 0) {
        throw new PigeDomainError("restore.backup_invalid", "Backup files failed validation.");
      }

      const restoredVaultPath = path.join(
        restoreParentDirectory,
        normalizeVaultName(`${manifest.vaultName} Restored`)
      );
      fs.mkdirSync(restoreParentDirectory, { recursive: true });
      const restoreParentIdentity = captureRestoreDirectoryIdentity(restoreParentDirectory);
      staging = createRestoreStagingDirectory(restoreParentDirectory);
      await extractBackupVault(archive.descriptor, manifest, staging.path);
      for (const rebuildableRoot of PIGE_REBUILDABLE_ROOTS) {
        fs.mkdirSync(path.join(staging.path, rebuildableRoot), { recursive: true });
      }
      for (const runtimeRoot of PIGE_TRANSIENT_RUNTIME_ROOTS) {
        fs.mkdirSync(path.join(staging.path, runtimeRoot), { recursive: true });
      }
      const snapshotAfterExtraction = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        snapshotAfterValidation,
        snapshotAfterExtraction,
        "The backup changed while it was restored."
      );
      assertRestorePreviewMatches(backupPath, snapshotAfterExtraction, previewToken);
      assertRestoreDirectoryIdentity(restoreParentDirectory, restoreParentIdentity);
      assertRestoreStagingIdentity(staging);
      validateExtractedRestore(staging.path, manifest);

      const publication = acquireRestorePublication(restoredVaultPath, previewToken, manifest);
      publishValidatedRestore(staging.path, manifest, publication);
      releaseRestorePublication(publication);

      return {
        status: "restored",
        restoredVaultPath,
        manifest: toManifestSummary(manifest)
      };
    } finally {
      fs.closeSync(archive.descriptor);
      if (staging) removeOwnedRestoreStagingDirectory(staging);
    }
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
    excludedRoots: [...PIGE_REBUILDABLE_ROOTS, ...PIGE_TRANSIENT_RUNTIME_ROOTS],
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

async function readBackupManifest(source: string | number): Promise<BackupManifest> {
  const manifestText = await readZipTextEntry(source, BACKUP_MANIFEST_FILE);
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

async function readZipTextEntry(source: string | number, entryName: string): Promise<string | undefined> {
  const zipFile = await openBackupZip(source);
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
  source: string | number,
  manifest: BackupManifest
): Promise<{ readonly invalidFiles: readonly string[] }> {
  const invalidFiles = new Set<string>();
  const manifestFilesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const seenManifestFiles = new Set<string>();
  const seenEntryNames = new Set<string>();
  let manifestEntryCount = 0;
  const zipFile = await openBackupZip(source);
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

async function extractBackupVault(
  source: string | number,
  manifest: BackupManifest,
  destinationPath: string
): Promise<void> {
  const manifestFiles = new Set(manifest.files.map((file) => file.path));
  const zipFile = await openBackupZip(source);
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      if (entry.fileName === BACKUP_MANIFEST_FILE || entry.fileName.endsWith("/")) continue;
      const relativePath = toVaultRelativeEntryPath(entry.fileName);
      if (!manifestFiles.has(relativePath)) {
        throw new PigeDomainError("restore.entry_unexpected", "Backup contains an unexpected vault entry.");
      }
      const targetPath = resolveRestoreTarget(destinationPath, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      await pipeline(await zipFile.openReadStreamPromise(entry), fs.createWriteStream(targetPath, { flags: "wx" }));
    }
  } finally {
    zipFile.close();
  }
}

async function openBackupZip(source: string | number) {
  const options = {
    lazyEntries: false,
    validateEntrySizes: true,
    strictFileNames: true
  } as const;
  return typeof source === "number"
    ? fromRandomAccessReaderPromise(
        new BorrowedArchiveReader(source),
        fs.fstatSync(source).size,
        { ...options, autoClose: false }
      )
    : openPromise(source, options);
}

class BorrowedArchiveReader extends RandomAccessReader {
  readonly #descriptor: number;

  constructor(descriptor: number) {
    super();
    this.#descriptor = descriptor;
  }

  override _readStreamForRange(start: number, end: number): Readable {
    let position = start;
    const descriptor = this.#descriptor;
    return new Readable({
      read(requestedBytes) {
        try {
          if (position >= end) {
            this.push(null);
            return;
          }
          const buffer = Buffer.allocUnsafe(Math.min(requestedBytes, end - position));
          const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position);
          if (bytesRead <= 0) {
            this.destroy(new Error("The borrowed archive ended during a bounded read."));
            return;
          }
          position += bytesRead;
          this.push(buffer.subarray(0, bytesRead));
        } catch (caught) {
          this.destroy(caught instanceof Error ? caught : new Error("The borrowed archive read failed."));
        }
      }
    });
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

function openRestoreArchive(filePath: string): RestoreArchiveHandle {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw new PigeDomainError("restore.backup_invalid", "The selected backup cannot be opened safely.");
  }
  try {
    return {
      path: filePath,
      descriptor,
      initialSnapshot: snapshotRestoreArchiveDescriptor(filePath, descriptor)
    };
  } catch (caught) {
    fs.closeSync(descriptor);
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("restore.backup_invalid", "The selected backup changed while it was read.");
  }
}

function snapshotRestoreArchive(archive: RestoreArchiveHandle): RestoreArchiveSnapshot {
  return snapshotRestoreArchiveDescriptor(archive.path, archive.descriptor);
}

function snapshotRestoreArchiveDescriptor(filePath: string, descriptor: number): RestoreArchiveSnapshot {
  try {
    const before = fs.fstatSync(descriptor);
    const pathBefore = fs.lstatSync(filePath);
    if (
      !before.isFile() ||
      pathBefore.isSymbolicLink() ||
      !pathBefore.isFile() ||
      !sameFileRevision(before, pathBefore)
    ) {
      throw new PigeDomainError("restore.backup_invalid", "The selected backup is not a stable regular file.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position
      );
      if (bytesRead <= 0) {
        throw new PigeDomainError("restore.backup_invalid", "The selected backup ended while it was read.");
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (
      pathAfter.isSymbolicLink() ||
      !sameFileRevision(before, after) ||
      !sameFileRevision(after, pathAfter)
    ) {
      throw new PigeDomainError("restore.backup_invalid", "The selected backup changed while it was read.");
    }
    return {
      size: after.size,
      checksum: `sha256:${hash.digest("hex")}`,
      revision: after
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("restore.backup_invalid", "The selected backup changed while it was read.");
  }
}

function createRestorePreviewToken(backupPath: string, snapshot: RestoreArchiveSnapshot): string {
  return `sha256:${createHash("sha256")
    .update("pige.restore.preview.v1\0", "utf8")
    .update(path.resolve(backupPath), "utf8")
    .update("\0", "utf8")
    .update(snapshot.checksum, "utf8")
    .update("\0", "utf8")
    .update(String(snapshot.size), "utf8")
    .digest("hex")}`;
}

function assertRestorePreviewToken(previewToken: string): void {
  if (!RESTORE_PREVIEW_TOKEN.test(previewToken)) {
    throw new PigeDomainError("restore.backup_invalid", "Create a current restore preview before applying restore.");
  }
}

function assertRestorePreviewMatches(
  backupPath: string,
  snapshot: RestoreArchiveSnapshot,
  previewToken: string
): void {
  if (createRestorePreviewToken(backupPath, snapshot) !== previewToken) {
    throw new PigeDomainError("restore.backup_invalid", "The backup changed after its restore preview.");
  }
}

function assertSameRestoreArchive(
  expected: RestoreArchiveSnapshot,
  current: RestoreArchiveSnapshot,
  message: string
): void {
  if (
    expected.size !== current.size ||
    expected.checksum !== current.checksum ||
    !sameFileRevision(expected.revision, current.revision)
  ) {
    throw new PigeDomainError("restore.backup_invalid", message);
  }
}

function captureRestoreDirectoryIdentity(directoryPath: string): fs.Stats {
  const identity = fs.lstatSync(directoryPath);
  if (!identity.isDirectory() || identity.isSymbolicLink()) {
    throw new PigeDomainError("restore.result_invalid", "The restore directory is not safe.");
  }
  return identity;
}

function assertRestoreDirectoryIdentity(directoryPath: string, expected: fs.Stats): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(directoryPath);
  } catch {
    throw new PigeDomainError("restore.result_invalid", "The restore directory changed during restore.");
  }
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    expected.dev !== current.dev ||
    expected.ino !== current.ino
  ) {
    throw new PigeDomainError("restore.result_invalid", "The restore directory changed during restore.");
  }
}

function createRestoreStagingDirectory(parentDirectory: string): RestoreStagingHandle {
  const stagingPath = fs.mkdtempSync(path.join(parentDirectory, ".pige-restore-"));
  fs.chmodSync(stagingPath, 0o700);
  const markerPath = path.join(stagingPath, RESTORE_STAGING_MARKER);
  const markerBody = `pige.restore.staging.v1:${randomUUID()}\n`;
  const markerIdentity = writeExclusiveRestoreFile(markerPath, markerBody);
  return {
    path: stagingPath,
    identity: captureRestoreDirectoryIdentity(stagingPath),
    markerPath,
    markerIdentity,
    markerBody
  };
}

function assertRestoreStagingIdentity(staging: RestoreStagingHandle): void {
  assertRestoreDirectoryIdentity(staging.path, staging.identity);
  assertOwnedRestoreFile(staging.markerPath, staging.markerIdentity, staging.markerBody);
}

function removeOwnedRestoreStagingDirectory(staging: RestoreStagingHandle): void {
  try {
    assertRestoreStagingIdentity(staging);
    fs.rmSync(staging.path, { recursive: true });
  } catch {
    // Leave uncertain staging in place rather than deleting a path whose identity changed.
  }
}

function validateExtractedRestore(directoryPath: string, manifest: BackupManifest): void {
  for (const file of manifest.files) {
    const filePath = resolveRestoreTarget(directoryPath, file.path);
    const snapshot = snapshotRestoredFile(filePath);
    if (snapshot.size !== file.size || snapshot.checksum !== file.checksum) {
      throw new PigeDomainError("restore.result_invalid", "A restored file failed checksum validation.");
    }
  }
  if (!isPigeVault(directoryPath)) {
    throw new PigeDomainError("restore.result_invalid", "Restored folder is not a compatible Pige vault.");
  }
}

function acquireRestorePublication(
  destinationPath: string,
  previewToken: string,
  manifest: BackupManifest
): RestorePublicationHandle {
  const sidecarPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.pige-restore.json`
  );
  let reservation: RestorePublicationReservation;
  let sidecarIdentity: fs.Stats;
  let createdSidecar = false;
  try {
    reservation = {
      identityVersion: 1,
      previewToken,
      reservationId: randomUUID()
    };
    sidecarIdentity = writeExclusiveRestoreFile(sidecarPath, serializeRestoreReservation(reservation));
    createdSidecar = true;
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readRestoreReservation(sidecarPath);
    if (existing.reservation.previewToken !== previewToken) {
      throw new PigeDomainError("restore.destination_exists", "Restore destination is reserved by another restore.");
    }
    reservation = existing.reservation;
    sidecarIdentity = existing.identity;
  }

  const reservationBody = serializeRestoreReservation(reservation);
  let destinationIdentity: fs.Stats;
  let createdDestination = false;
  try {
    fs.mkdirSync(destinationPath, { mode: 0o700 });
    destinationIdentity = captureRestoreDirectoryIdentity(destinationPath);
    createdDestination = true;
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) {
      if (createdSidecar) removeOwnedRestoreFile(sidecarPath, sidecarIdentity, reservationBody);
      throw caught;
    }
    try {
      destinationIdentity = captureRestoreDirectoryIdentity(destinationPath);
    } catch {
      if (createdSidecar) removeOwnedRestoreFile(sidecarPath, sidecarIdentity, reservationBody);
      throw new PigeDomainError("restore.destination_exists", "Restore destination cannot be reserved safely.");
    }
  }

  const markerPath = path.join(destinationPath, ...RESTORE_PUBLICATION_MARKER.split("/"));
  if (fs.existsSync(markerPath)) {
    const marker = readRestoreReservation(markerPath);
    if (serializeRestoreReservation(marker.reservation) !== reservationBody) {
      if (createdSidecar) removeOwnedRestoreFile(sidecarPath, sidecarIdentity, reservationBody);
      throw new PigeDomainError("restore.destination_exists", "Restore destination belongs to another operation.");
    }
    return {
      reservation,
      sidecarPath,
      sidecarIdentity,
      destinationPath,
      destinationIdentity,
      markerPath,
      markerIdentity: marker.identity,
      alreadyCommitted: isPigeVault(destinationPath)
    };
  }

  if (!createdSidecar && !createdDestination && directoryContainsEntries(destinationPath)) {
    validateExtractedRestore(destinationPath, manifest);
    return {
      reservation,
      sidecarPath,
      sidecarIdentity,
      destinationPath,
      destinationIdentity,
      alreadyCommitted: true
    };
  }

  if (createdSidecar && !createdDestination) {
    removeOwnedRestoreFile(sidecarPath, sidecarIdentity, reservationBody);
    throw new PigeDomainError("restore.destination_exists", "Restore destination already exists.");
  }
  const markerIdentity = writeExclusiveRestoreFile(markerPath, reservationBody);
  return {
    reservation,
    sidecarPath,
    sidecarIdentity,
    destinationPath,
    destinationIdentity,
    markerPath,
    markerIdentity,
    alreadyCommitted: false
  };
}

function publishValidatedRestore(
  stagingPath: string,
  manifest: BackupManifest,
  publication: RestorePublicationHandle
): void {
  if (!publication.alreadyCommitted) {
    for (const file of manifest.files) {
      if (file.path === RESTORE_COMMIT_ENTRY) continue;
      publishRestoreFile(stagingPath, file, publication);
    }
    for (const rebuildableRoot of PIGE_REBUILDABLE_ROOTS) {
      ensureRestorePublicationDirectory(
        path.join(publication.destinationPath, rebuildableRoot),
        publication
      );
    }
    for (const runtimeRoot of PIGE_TRANSIENT_RUNTIME_ROOTS) {
      ensureRestorePublicationDirectory(
        path.join(publication.destinationPath, runtimeRoot),
        publication
      );
    }
    assertRestorePublicationIdentity(publication);
    publishRestoreFile(
      stagingPath,
      requireRestoreManifestFile(manifest, RESTORE_COMMIT_ENTRY),
      publication
    );
  }
  reconcileRestorePublicationTemps(manifest, publication);
  assertRestorePublicationIdentity(publication);
  validateExtractedRestore(publication.destinationPath, manifest);
}

function publishRestoreFile(
  stagingPath: string,
  file: BackupManifestFile,
  publication: RestorePublicationHandle
): void {
  const sourcePath = resolveRestoreTarget(stagingPath, file.path);
  const targetPath = resolveRestoreTarget(publication.destinationPath, file.path);
  ensureRestorePublicationDirectory(path.dirname(targetPath), publication);
  assertRestorePublicationIdentity(publication);
  if (fs.existsSync(targetPath)) {
    assertPublishedRestoreFile(targetPath, file);
    removeRestorePublicationTempFile(restorePublicationTempPath(targetPath, file, publication), publication);
    return;
  }
  const temporaryPath = restorePublicationTempPath(targetPath, file, publication);
  prepareRestorePublicationTempFile(sourcePath, temporaryPath, file, publication);
  assertRestorePublicationIdentity(publication);
  try {
    fs.linkSync(temporaryPath, targetPath);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
  }
  assertPublishedRestoreFile(targetPath, file);
  removeRestorePublicationTempFile(temporaryPath, publication);
  fsyncDirectoryBestEffort(path.dirname(targetPath));
}

function prepareRestorePublicationTempFile(
  sourcePath: string,
  temporaryPath: string,
  file: BackupManifestFile,
  publication: RestorePublicationHandle
): void {
  if (fs.existsSync(temporaryPath)) {
    try {
      assertPublishedRestoreFile(temporaryPath, file);
      fsyncFile(temporaryPath);
      assertPublishedRestoreFile(temporaryPath, file);
      return;
    } catch {
      removeRestorePublicationTempFile(temporaryPath, publication);
    }
  }
  assertRestorePublicationIdentity(publication);
  fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
  fsyncFile(temporaryPath);
  assertPublishedRestoreFile(temporaryPath, file);
}

function reconcileRestorePublicationTemps(
  manifest: BackupManifest,
  publication: RestorePublicationHandle
): void {
  const targetDirectories = new Set<string>();
  for (const file of manifest.files) {
    const targetPath = resolveRestoreTarget(publication.destinationPath, file.path);
    targetDirectories.add(path.dirname(targetPath));
    removeRestorePublicationTempFile(restorePublicationTempPath(targetPath, file, publication), publication);
  }
  for (const directoryPath of targetDirectories) fsyncDirectoryBestEffort(directoryPath);
}

function assertPublishedRestoreFile(filePath: string, file: BackupManifestFile): void {
  const snapshot = snapshotRestoredFile(filePath);
  if (snapshot.size !== file.size || snapshot.checksum !== file.checksum) {
    throw new PigeDomainError("restore.result_invalid", "Restore destination contains conflicting bytes.");
  }
}

function restorePublicationTempPath(
  targetPath: string,
  file: BackupManifestFile,
  publication: RestorePublicationHandle
): string {
  const fileIdentity = createHash("sha256").update(file.path, "utf8").digest("hex").slice(0, 16);
  return path.join(
    path.dirname(targetPath),
    `.pige-restore-${publication.reservation.reservationId}-${fileIdentity}.tmp`
  );
}

function removeRestorePublicationTempFile(
  temporaryPath: string,
  publication: RestorePublicationHandle
): void {
  if (!fs.existsSync(temporaryPath)) return;
  assertRestorePublicationIdentity(publication);
  const identity = fs.lstatSync(temporaryPath);
  if (!identity.isFile() || identity.isSymbolicLink()) {
    throw new PigeDomainError("restore.result_invalid", "Restore temporary publication path is not safe.");
  }
  fs.unlinkSync(temporaryPath);
}

function ensureRestorePublicationDirectory(
  directoryPath: string,
  publication: RestorePublicationHandle
): void {
  const relativePath = path.relative(publication.destinationPath, directoryPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new PigeDomainError("restore.result_invalid", "Restore directory escaped its reserved destination.");
  }
  let currentPath = publication.destinationPath;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    assertRestorePublicationIdentity(publication);
    currentPath = path.join(currentPath, segment);
    try {
      fs.mkdirSync(currentPath, { mode: 0o700 });
    } catch (caught) {
      if (!isErrno(caught, "EEXIST")) throw caught;
    }
    const current = fs.lstatSync(currentPath);
    if (!current.isDirectory() || current.isSymbolicLink()) {
      throw new PigeDomainError("restore.result_invalid", "Restore directory traversal was not safe.");
    }
  }
}

function assertRestorePublicationIdentity(publication: RestorePublicationHandle): void {
  const reservationBody = serializeRestoreReservation(publication.reservation);
  assertOwnedRestoreFile(publication.sidecarPath, publication.sidecarIdentity, reservationBody);
  assertRestoreDirectoryIdentity(publication.destinationPath, publication.destinationIdentity);
  if (publication.markerPath && publication.markerIdentity) {
    assertOwnedRestoreFile(publication.markerPath, publication.markerIdentity, reservationBody);
  }
}

function releaseRestorePublication(publication: RestorePublicationHandle): void {
  const reservationBody = serializeRestoreReservation(publication.reservation);
  if (publication.markerPath && publication.markerIdentity) {
    removeOwnedRestoreFile(publication.markerPath, publication.markerIdentity, reservationBody);
  }
  removeOwnedRestoreFile(publication.sidecarPath, publication.sidecarIdentity, reservationBody);
  fsyncDirectoryBestEffort(publication.destinationPath);
  fsyncDirectoryBestEffort(path.dirname(publication.destinationPath));
}

function requireRestoreManifestFile(manifest: BackupManifest, filePath: string): BackupManifestFile {
  const file = manifest.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new PigeDomainError("restore.backup_invalid", "Backup vault manifest is missing.");
  return file;
}

function directoryContainsEntries(directoryPath: string): boolean {
  return fs.readdirSync(directoryPath).length > 0;
}

function serializeRestoreReservation(reservation: RestorePublicationReservation): string {
  return `${JSON.stringify(reservation)}\n`;
}

function readRestoreReservation(filePath: string): {
  readonly reservation: RestorePublicationReservation;
  readonly identity: fs.Stats;
} {
  const snapshot = readOwnedRestoreFile(filePath);
  let value: unknown;
  try {
    value = JSON.parse(snapshot.body);
  } catch {
    throw new PigeDomainError("restore.destination_exists", "Restore reservation is not valid.");
  }
  if (
    !isRecord(value) ||
    value.identityVersion !== 1 ||
    typeof value.previewToken !== "string" ||
    !RESTORE_PREVIEW_TOKEN.test(value.previewToken) ||
    typeof value.reservationId !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(value.reservationId)
  ) {
    throw new PigeDomainError("restore.destination_exists", "Restore reservation is not valid.");
  }
  return {
    reservation: {
      identityVersion: 1,
      previewToken: value.previewToken,
      reservationId: value.reservationId
    },
    identity: snapshot.identity
  };
}

function writeExclusiveRestoreFile(filePath: string, body: string): fs.Stats {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags, 0o600);
  try {
    fs.writeFileSync(descriptor, body, "utf8");
    fs.fsyncSync(descriptor);
    return fs.fstatSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readOwnedRestoreFile(filePath: string): { readonly body: string; readonly identity: fs.Stats } {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor);
    const pathIdentity = fs.lstatSync(filePath);
    if (!sameFileRevision(before, pathIdentity) || before.size > 4096) {
      throw new PigeDomainError("restore.destination_exists", "Restore reservation changed unexpectedly.");
    }
    const body = fs.readFileSync(descriptor, "utf8");
    const after = fs.fstatSync(descriptor);
    if (!sameFileRevision(before, after)) {
      throw new PigeDomainError("restore.destination_exists", "Restore reservation changed unexpectedly.");
    }
    return { body, identity: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertOwnedRestoreFile(filePath: string, expected: fs.Stats, body: string): void {
  const current = readOwnedRestoreFile(filePath);
  if (!sameFileRevision(expected, current.identity) || current.body !== body) {
    throw new PigeDomainError("restore.result_invalid", "Restore ownership changed during publication.");
  }
}

function removeOwnedRestoreFile(filePath: string, expected: fs.Stats, body: string): void {
  try {
    assertOwnedRestoreFile(filePath, expected, body);
    fs.unlinkSync(filePath);
  } catch {
    // A stale ownership marker is safer than unlinking a path whose identity changed.
  }
}

function snapshotRestoredFile(filePath: string): { readonly size: number; readonly checksum: string } {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw new PigeDomainError("restore.result_invalid", "A restored file could not be opened safely.");
  }
  try {
    const before = fs.fstatSync(descriptor);
    const pathIdentity = fs.lstatSync(filePath);
    if (!sameFileRevision(before, pathIdentity)) {
      throw new PigeDomainError("restore.result_invalid", "A restored file changed unexpectedly.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (position < before.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (bytesRead <= 0) throw new PigeDomainError("restore.result_invalid", "A restored file ended unexpectedly.");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (!sameFileRevision(before, after) || !sameFileRevision(after, pathAfter)) {
      throw new PigeDomainError("restore.result_invalid", "A restored file changed unexpectedly.");
    }
    return { size: after.size, checksum: `sha256:${hash.digest("hex")}` };
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncFile(filePath: string): void {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
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
