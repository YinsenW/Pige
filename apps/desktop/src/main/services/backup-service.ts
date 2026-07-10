import { createHash } from "node:crypto";
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
    if (fs.existsSync(backupFilePath)) {
      throw new PigeDomainError("backup.destination_exists", "Backup file already exists.");
    }

    const manifest = createBackupManifest(vaultPath, appVersion);
    const zipFile = new ZipFile();
    fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
    zipFile.addBuffer(
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      BACKUP_MANIFEST_FILE,
      { mtime: new Date(manifest.createdAt) }
    );
    for (const file of manifest.files) {
      zipFile.addFile(
        path.join(vaultPath, ...file.path.split("/")),
        `${BACKUP_VAULT_DIR}/${file.path}`,
        { mtime: fs.statSync(path.join(vaultPath, ...file.path.split("/"))).mtime }
      );
    }
    zipFile.end();

    try {
      await pipeline(zipFile.outputStream, fs.createWriteStream(backupFilePath, { flags: "wx" }));
    } catch (caught) {
      fs.rmSync(backupFilePath, { force: true });
      throw caught;
    }

    return {
      status: "created",
      backupPath: backupFilePath,
      manifest: toManifestSummary(manifest)
    };
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
    const stat = fs.statSync(absolutePath);
    return {
      path: relativePath,
      size: stat.size,
      checksum: checksumFile(absolutePath)
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
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.size !== "number" || typeof file.checksum !== "string") {
      throw new PigeDomainError("restore.manifest_invalid", "Backup manifest contains invalid file entries.");
    }
    assertSafeVaultRelativePath(file.path);
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
  const zipFile = await openPromise(backupPath, { lazyEntries: false, validateEntrySizes: true, strictFileNames: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      if (entry.fileName === BACKUP_MANIFEST_FILE) continue;
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
