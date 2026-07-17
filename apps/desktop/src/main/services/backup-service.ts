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
  RestoreMode,
  RestorePreviewWarning,
  VaultSummary
} from "@pige/contracts";
import { PIGE_APP_MIN_VERSION, PigeDomainError } from "@pige/domain";
import { parsePigeFrontmatter } from "@pige/markdown";
import {
  BackupDomainSchemaVersionsSchema,
  BackupIdSchema,
  BackupManifestSchema,
  JobIdSchema,
  SourceRecordSchema,
  VaultBindingsFileSchema,
  VaultIdSchema,
  VaultManifestSchema,
  type BackupDomainSchemaVersions,
  type BackupManifest,
  type ExternalManagedCopyRootBinding,
  type SourceRecord,
  type VaultManifest
} from "@pige/schemas";
import {
  PIGE_DURABLE_ROOTS,
  PIGE_REBUILDABLE_ROOTS,
  PIGE_TRANSIENT_RUNTIME_ROOTS,
  assertVaultPathAllowed,
  isPigeVault,
  normalizeVaultName,
  readVaultManifest,
  type VaultPathSafetyOptions
} from "./vault-layout";

interface ExternalManagedCopyRootIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

interface VerifiedExternalManagedCopyRoot {
  readonly rootId: string;
  readonly vaultId: string;
  readonly absolutePath: string;
  readonly identities: readonly ExternalManagedCopyRootIdentity[];
  readonly registryPath: string;
  readonly bindingFingerprint: `sha256:${string}`;
}

export class BackupManagedCopyDependencyError extends PigeDomainError {
  readonly dependencyKind: "vault_binding" | "external_source";
  readonly dependencyId: string;

  constructor(
    code: string,
    message: string,
    dependencyKind: "vault_binding" | "external_source",
    dependencyId: string
  ) {
    super(code, message);
    this.name = "BackupManagedCopyDependencyError";
    this.dependencyKind = dependencyKind;
    this.dependencyId = dependencyId;
  }
}

function readExternalManagedCopyRoots(
  userDataPathInput: string | undefined,
  vaultId: string,
  requestedRootIds: ReadonlySet<string>
): ReadonlyMap<string, VerifiedExternalManagedCopyRoot> {
  if (requestedRootIds.size === 0) return new Map();
  if (!userDataPathInput) {
    throw missingExternalManagedCopyRoot([...requestedRootIds].sort()[0]!);
  }

  const userDataPath = captureCanonicalBindingDirectory(userDataPathInput);
  const bindingsPath = path.join(userDataPath, "vault-bindings.json");
  const bindings = readBindingsFile(bindingsPath);
  const vaultRoots = bindings.roots.filter((root) => root.vaultId === vaultId);
  assertDistinctBindingPaths(vaultRoots);
  const rootsById = new Map(vaultRoots.map((root) => [root.rootId, root]));
  const resolved = new Map<string, VerifiedExternalManagedCopyRoot>();

  for (const rootId of [...requestedRootIds].sort()) {
    const binding = rootsById.get(rootId);
    if (!binding || binding.availability !== "available") {
      throw missingExternalManagedCopyRoot(rootId);
    }
    resolved.set(rootId, captureExternalManagedCopyRoot(binding, bindingsPath));
  }
  return resolved;
}

function assertExternalManagedCopyRootIdentity(root: VerifiedExternalManagedCopyRoot): void {
  assertExternalManagedCopyRootBinding(root);
  for (const expected of root.identities) {
    let current: fs.Stats;
    try {
      current = fs.lstatSync(expected.path);
    } catch {
      throw missingExternalManagedCopyRoot(root.rootId);
    }
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== expected.device ||
      current.ino !== expected.inode
    ) {
      throw new PigeDomainError(
        "backup.external_managed_copy_root_changed",
        "An external managed-copy root changed during backup."
      );
    }
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync.native(root.absolutePath);
  } catch {
    throw missingExternalManagedCopyRoot(root.rootId);
  }
  if (canonicalRoot !== root.absolutePath) {
    throw new PigeDomainError(
      "backup.external_managed_copy_root_changed",
      "An external managed-copy root changed during backup."
    );
  }
  assertExternalManagedCopyRootBinding(root);
}

function assertExternalManagedCopyRootBinding(root: VerifiedExternalManagedCopyRoot): void {
  const current = readBindingsFile(root.registryPath).roots.find((binding) =>
    binding.rootId === root.rootId && binding.vaultId === root.vaultId
  );
  if (
    !current ||
    current.availability !== "available" ||
    current.absolutePath !== root.absolutePath ||
    fingerprintExternalManagedCopyRootBinding(current) !== root.bindingFingerprint
  ) {
    throw new BackupManagedCopyDependencyError(
      "backup.external_managed_copy_binding_changed",
      "An external managed-copy root binding changed during backup.",
      "vault_binding",
      root.rootId
    );
  }
}

function readBindingsFile(bindingsPath: string) {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(bindingsPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    const pathBefore = fs.lstatSync(bindingsPath);
    if (
      !before.isFile() ||
      pathBefore.isSymbolicLink() ||
      before.nlink !== 1 ||
      pathBefore.nlink !== 1 ||
      !sameFileRevision(before, pathBefore) ||
      before.size > 4 * 1024 * 1024
    ) {
      throw new Error("The root registry is unsafe.");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(bindingsPath);
    if (!sameFileRevision(before, after) || !sameFileRevision(after, pathAfter)) {
      throw new Error("The root registry changed while it was read.");
    }
    return VaultBindingsFileSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) {
      return VaultBindingsFileSchema.parse({ schemaVersion: 1, roots: [], defaults: [] });
    }
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "backup.root_binding_registry_invalid",
      "The external managed-copy root registry is unavailable or invalid."
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function captureExternalManagedCopyRoot(
  binding: ExternalManagedCopyRootBinding,
  registryPath: string
): VerifiedExternalManagedCopyRoot {
  if (!path.isAbsolute(binding.absolutePath) || path.resolve(binding.absolutePath) !== binding.absolutePath) {
    throw new PigeDomainError(
      "backup.root_binding_invalid",
      "An external managed-copy root binding is not canonical."
    );
  }
  const identities = captureExternalDirectoryChain(binding.absolutePath, binding.rootId);
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync.native(binding.absolutePath);
  } catch {
    throw missingExternalManagedCopyRoot(binding.rootId);
  }
  if (canonicalRoot !== binding.absolutePath) {
    throw new PigeDomainError(
      "backup.root_binding_invalid",
      "An external managed-copy root binding contains a symbolic link."
    );
  }
  return {
    rootId: binding.rootId,
    vaultId: binding.vaultId,
    absolutePath: binding.absolutePath,
    identities,
    registryPath,
    bindingFingerprint: fingerprintExternalManagedCopyRootBinding(binding)
  };
}

function fingerprintExternalManagedCopyRootBinding(
  binding: ExternalManagedCopyRootBinding
): `sha256:${string}` {
  return checksumBuffer(Buffer.from(JSON.stringify(binding), "utf8"));
}

function captureExternalDirectoryChain(
  directoryPath: string,
  rootId: string
): readonly ExternalManagedCopyRootIdentity[] {
  const filesystemRoot = path.parse(directoryPath).root;
  const relative = path.relative(filesystemRoot, directoryPath);
  const paths = [filesystemRoot];
  let current = filesystemRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths.map((entryPath) => {
    let identity: fs.Stats;
    try {
      identity = fs.lstatSync(entryPath);
    } catch {
      throw missingExternalManagedCopyRoot(rootId);
    }
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw new PigeDomainError(
        "backup.root_binding_invalid",
        "An external managed-copy root binding contains a non-directory or symbolic-link component."
      );
    }
    return { path: entryPath, device: identity.dev, inode: identity.ino };
  });
}

function assertDistinctBindingPaths(roots: readonly ExternalManagedCopyRootBinding[]): void {
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

function captureCanonicalBindingDirectory(directoryPathInput: string): string {
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

function missingExternalManagedCopyRoot(rootId: string): BackupManagedCopyDependencyError {
  return new BackupManagedCopyDependencyError(
    "backup.external_managed_copy_root_missing",
    "A required external managed-copy root must be reconnected before backup.",
    "vault_binding",
    rootId
  );
}

type BackupManifestFile = BackupManifest["files"][number];

export type RestoreIdentityMode = RestoreMode;
export type RestoreBackupIdSource = "manifest" | "derived_legacy";
export type RestoreCoreCheckpointPhase =
  | "manifest_validated"
  | "destination_reserved"
  | "archive_extracted"
  | "durable_domains_migrated"
  | "external_dependencies_reconciled"
  | "vault_identity_finalized"
  | "destination_committed";

export interface RestoreCoreCheckpointEvent {
  readonly phase: RestoreCoreCheckpointPhase;
  readonly jobId: string;
  readonly previewId: string;
  readonly archiveDigest: string;
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
  readonly mode: RestoreIdentityMode;
  readonly sourceVaultId: string;
  readonly resultVaultId: string;
  readonly destinationIdentity: string;
  readonly externalDependencyCount: number;
}

export type RestoreCorePhaseReporter = (
  event: RestoreCoreCheckpointEvent
) => void | Promise<void>;

export interface RestoreCorePreviewResult {
  readonly backupPath: string;
  readonly archivePreviewToken: string;
  readonly archiveDigest: string;
  readonly archiveSize: number;
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
  readonly sourceVaultId: string;
  readonly sourceVaultSchemaVersion: number;
  readonly manifest: BackupManifestSummary;
  readonly invalidFileCount: number;
  readonly warnings: readonly RestorePreviewWarning[];
}

export interface RestoreDestinationIdentity {
  readonly destinationPath: string;
  readonly parentPath: string;
  readonly identityDigest: string;
}

export interface RestoreCoreApplyInput {
  readonly backupPath: string;
  readonly archivePreviewToken: string;
  readonly previewId: string;
  readonly archiveDigest: string;
  readonly jobId: string;
  readonly mode: RestoreIdentityMode;
  readonly sourceVaultId: string;
  readonly resultVaultId: string;
  readonly destinationIdentity: RestoreDestinationIdentity;
  readonly pathSafety: VaultPathSafetyOptions;
  readonly onPhase?: RestoreCorePhaseReporter;
}

export interface RestoreCoreApplyResult {
  readonly status: "restored";
  readonly restoredVaultPath: string;
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
  readonly archiveDigest: string;
  readonly mode: RestoreIdentityMode;
  readonly sourceVaultId: string;
  readonly resultVaultId: string;
  readonly destinationIdentity: RestoreDestinationIdentity;
  readonly manifest: BackupManifestSummary;
}

export interface BackupCreateOptions {
  readonly excludeJobId?: string;
  readonly backupId?: string;
  readonly createdAt?: string;
  readonly stagingOwnerKey?: string;
  readonly expectedDestinationFence?: BackupDestinationFence;
  readonly expectedManifestChecksum?: `sha256:${string}`;
  readonly expectedArchiveDigest?: `sha256:${string}`;
  readonly signal?: AbortSignal;
  readonly onPhase?: BackupCreatePhaseReporter;
}

export interface BackupRestoreServiceOptions {
  readonly userDataPath?: string;
}

export interface BackupDestinationFence {
  readonly destinationPath: string;
  readonly ancestorPath: string;
  readonly ancestorDevice: number;
  readonly ancestorInode: number;
}

export type BackupCreateCheckpointPhase =
  | "preflight"
  | "manifest_written"
  | "files_hashed"
  | "archive_staged"
  | "archive_finalized";

export interface BackupCreateCheckpointEvent {
  readonly phase: BackupCreateCheckpointPhase;
  readonly backupId: string;
  readonly createdAt: string;
  readonly stagingOwnerKey: string;
  readonly manifestChecksum?: `sha256:${string}`;
  readonly archiveDigest?: `sha256:${string}`;
}

export type BackupCreatePhaseReporter = (
  event: BackupCreateCheckpointEvent
) => void | Promise<void>;

interface BackupCreateIdentity {
  readonly backupId: string;
  readonly createdAt: string;
  readonly stagingOwnerKey: string;
}

interface BackupPreflightResult {
  readonly relativePaths: readonly string[];
  readonly archiveSources: ReadonlyMap<string, BackupArchiveSource>;
  readonly sourceRecordChecksums: ReadonlyMap<string, string>;
  readonly domainSchemaVersions: BackupDomainSchemaVersions;
  readonly externalDependencies: BackupManifest["externalDependencies"];
  readonly externalManagedCopies: NonNullable<BackupManifest["externalManagedCopies"]>;
}

interface BackupArchiveSource {
  readonly absolutePath: string;
  readonly kind: "vault" | "external_managed_copy";
  readonly expectedChecksum?: string;
  readonly expectedSize?: number;
  readonly sourceId?: string;
  readonly root?: VerifiedExternalManagedCopyRoot;
  readonly parentIdentities?: readonly ExternalManagedCopyRootIdentity[];
}

interface PreparedBackupFile extends BackupManifestFile {
  readonly absolutePath: string;
  readonly identity: fs.Stats;
  readonly source: BackupArchiveSource;
}

interface PreparedBackupManifest {
  readonly manifest: BackupManifest;
  readonly files: readonly PreparedBackupFile[];
}

interface AdoptedBackupArchive {
  readonly manifest: BackupManifest;
  readonly manifestChecksum: `sha256:${string}`;
  readonly archiveDigest: `sha256:${string}`;
  readonly identity: fs.Stats;
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

interface RestoreApplyBinding {
  readonly identityVersion: 2;
  readonly jobId: string;
  readonly previewId: string;
  readonly archiveDigest: string;
  readonly mode: RestoreIdentityMode;
  readonly sourceVaultId: string;
  readonly resultVaultId: string;
  readonly destinationIdentity: string;
}

interface RestorePublicationReservation extends RestoreApplyBinding {
  readonly reservationId: string;
}

interface RestorePublicationReservationHandle {
  readonly reservation: RestorePublicationReservation;
  readonly sidecarPath: string;
  readonly sidecarIdentity: fs.Stats;
  readonly createdSidecar: boolean;
  readonly destinationCoordinates: RestoreDestinationCoordinates;
  readonly pathSafety: VaultPathSafetyOptions;
}

interface RestorePublicationHandle extends RestorePublicationReservationHandle {
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
  readonly destinationCoordinates: RestoreDestinationCoordinates;
  readonly pathSafety: VaultPathSafetyOptions;
}

interface RestoreAncestorIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

interface RestoreDestinationCoordinates extends RestoreDestinationIdentity {
  readonly ancestors: readonly RestoreAncestorIdentity[];
}

interface ResolvedBackupIdentity {
  readonly backupId: string;
  readonly backupIdSource: RestoreBackupIdSource;
}

type RestoreCoreCheckpointContext = Omit<RestoreCoreCheckpointEvent, "phase">;

const BACKUP_FORMAT = "pige-backup";
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_MANIFEST_FILE = "pige-backup-manifest.json";
const BACKUP_VAULT_DIR = "vault";
const RESTORE_COMMIT_ENTRY = ".pige/manifest.json";
const RESTORE_PUBLICATION_MARKER = ".pige-restore-publication.json";
const RESTORE_STAGING_MARKER = ".pige-restore-staging-owner";
const RESTORE_PREVIEW_TOKEN = /^sha256:[a-f0-9]{64}$/u;
const RESTORE_PREVIEW_ID = /^sha256:[a-f0-9]{64}$/u;
const DEFAULT_INCLUDES = {
  markdownKnowledge: true,
  sourceRecords: true,
  managedSourceCopies: true,
  conversations: true,
  vaultMemory: true,
  trash: true,
  rebuildableDatabaseCache: false,
  secrets: false
} as const satisfies BackupRestoreStatus["defaultIncludes"];

const ROOT_FILES = ["PIGE.md", "index.md", "log.md", ".pige/manifest.json", ".pige/config.json"] as const;

export class BackupRestoreService {
  readonly #userDataPath: string | undefined;

  constructor(options: BackupRestoreServiceOptions = {}) {
    this.#userDataPath = options.userDataPath;
  }

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
    appVersion = PIGE_APP_MIN_VERSION,
    options: BackupCreateOptions = {}
  ): Promise<BackupCreateResult> {
    const resolvedVaultPath = path.resolve(vaultPathInput);
    const identity = createBackupIdentity(options);
    const checkpointContext = identity satisfies Omit<BackupCreateCheckpointEvent, "phase">;
    if (!isPigeVault(resolvedVaultPath)) {
      throw new PigeDomainError("backup.vault_invalid", "Active vault is not a compatible Pige vault.");
    }
    const vaultPath = fs.realpathSync.native(resolvedVaultPath);
    const destinationFence = captureBackupDestinationFence(backupFilePathInput);
    assertExpectedBackupDestinationFence(destinationFence, options.expectedDestinationFence);
    const canonicalBackupFilePath = destinationFence.destinationPath;
    if (isSameOrInside(canonicalBackupFilePath, vaultPath)) {
      throw new PigeDomainError("backup.path_inside_vault", "Backup file cannot be created inside the active vault.");
    }
    const backupFilePath = prepareBackupDestinationPath(canonicalBackupFilePath);
    assertBackupDestinationFence(destinationFence);
    const destinationParentIdentity = captureBackupDestinationParent(backupFilePath);
    reconcilePublishedBackupStagingLinks(backupFilePath);
    assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
    const stagingPath = createBackupStagingPath(backupFilePath, identity.stagingOwnerKey);
    const vaultId = readVaultManifest(vaultPath).vault_id;
    if (fs.existsSync(backupFilePath)) {
      assertDurableAdoptionDigests(options, "destination");
      const adopted = await inspectAdoptableBackupArchive(
        backupFilePath,
        identity,
        vaultId,
        appVersion,
        options,
        "destination"
      );
      assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
      assertAdoptableFinalLinkOwnership(stagingPath, backupFilePath, adopted.identity);
      removeExactAdoptedStagingLink(stagingPath, backupFilePath);
      await reportAdoptedBackupPhases(options.onPhase, checkpointContext, adopted);
      return {
        status: "created",
        backupPath: backupFilePath,
        manifest: toManifestSummary(adopted.manifest)
      };
    }
    if (fs.existsSync(stagingPath)) {
      assertDurableAdoptionDigests(options, "existing_staging");
      const adopted = await inspectAdoptableBackupArchive(
        stagingPath,
        identity,
        vaultId,
        appVersion,
        options,
        "existing_staging"
      );
      await reportAdoptedBackupPhases(options.onPhase, checkpointContext, adopted, false);
      if (options.signal?.aborted) {
        removeOwnedFile(stagingPath, adopted.identity);
        throwIfBackupAborted(options.signal);
      }
      publishAdoptedBackupStaging(
        stagingPath,
        backupFilePath,
        adopted,
        destinationParentIdentity
      );
      await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_finalized", {
        manifestChecksum: adopted.manifestChecksum,
        archiveDigest: adopted.archiveDigest
      });
      return {
        status: "created",
        backupPath: backupFilePath,
        manifest: toManifestSummary(adopted.manifest)
      };
    }
    throwIfBackupAborted(options.signal);
    const preflight = inspectBackupPreflight(vaultPath, options, this.#userDataPath);
    await reportBackupCreatePhase(options.onPhase, checkpointContext, "preflight");
    throwIfBackupAborted(options.signal);
    const prepared = createBackupManifest(vaultPath, appVersion, identity, preflight, options.signal);
    const manifest = prepared.manifest;
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestChecksum = checksumBuffer(Buffer.from(manifestText, "utf8"));
    await reportBackupCreatePhase(options.onPhase, checkpointContext, "manifest_written", { manifestChecksum });
    throwIfBackupAborted(options.signal);
    await reportBackupCreatePhase(options.onPhase, checkpointContext, "files_hashed", { manifestChecksum });
    throwIfBackupAborted(options.signal);
    const result: BackupCreateResult = {
      status: "created",
      backupPath: backupFilePath,
      manifest: toManifestSummary(manifest)
    };
    let descriptor: number | undefined;
    let stagingIdentity: fs.Stats | undefined;
    let stagingValidated = false;
    let cleanupStaging = true;
    let linkedDestination = false;
    let finalized = false;

    try {
      assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
      if (fs.existsSync(backupFilePath)) {
        const destinationIdentity = await assertExactBackupArchive(
          backupFilePath,
          manifest,
          manifestText,
          options.signal,
          "destination"
        );
        assertAdoptableFinalLinkOwnership(stagingPath, backupFilePath, destinationIdentity);
        const archiveDigest = checksumFile(backupFilePath) as `sha256:${string}`;
        removeExactAdoptedStagingLink(stagingPath, backupFilePath);
        await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_staged", {
          manifestChecksum,
          archiveDigest
        });
        await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_finalized", {
          manifestChecksum,
          archiveDigest
        });
        return result;
      }

      if (fs.existsSync(stagingPath)) {
        stagingIdentity = await assertExactBackupArchive(
          stagingPath,
          manifest,
          manifestText,
          options.signal,
          "existing_staging"
        );
        stagingValidated = true;
        cleanupStaging = false;
      } else {
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
        for (const file of prepared.files) {
          throwIfBackupAborted(options.signal);
          zipFile.addReadStreamLazy(
            `${BACKUP_VAULT_DIR}/${file.path}`,
            {
              size: file.size,
              mtime: file.identity.mtime,
              mode: file.identity.mode
            },
            (callback) => {
              try {
                callback(null, createVerifiedBackupReadStream(file, options.signal));
              } catch (caught) {
                callback(caught, undefined as never);
              }
            }
          );
        }
        zipFile.end();

        const output = fs.createWriteStream(stagingPath, { fd: descriptor, autoClose: false });
        zipFile.on("error", (caught) => {
          (zipFile.outputStream as Readable).destroy(
            caught instanceof Error ? caught : new Error("Backup archive source failed.")
          );
        });
        if (options.signal) {
          await pipeline(zipFile.outputStream, output, { signal: options.signal });
        } else {
          await pipeline(zipFile.outputStream, output);
        }
        for (const file of prepared.files) assertPreparedBackupFile(file);
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

        const validatedIdentity = await assertExactBackupArchive(
          stagingPath,
          manifest,
          manifestText,
          options.signal,
          "staging"
        );
        if (!sameFileRevision(stagingIdentity, validatedIdentity)) {
          throw new PigeDomainError("backup.staging_changed", "Backup staging archive changed during validation.");
        }
        stagingIdentity = validatedIdentity;
        stagingValidated = true;
        cleanupStaging = false;
      }
      const stagedArchiveChecksum = checksumFile(stagingPath) as `sha256:${string}`;
      try {
        await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_staged", {
          manifestChecksum,
          archiveDigest: stagedArchiveChecksum
        });
      } catch (caught) {
        if (isBackupAbortError(caught)) cleanupStaging = true;
        throw caught;
      }
      if (options.signal?.aborted) cleanupStaging = true;
      throwIfBackupAborted(options.signal);
      cleanupStaging = true;

      try {
        assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
        fs.linkSync(stagingPath, backupFilePath);
        linkedDestination = true;
      } catch (caught) {
        if (isErrno(caught, "EEXIST")) {
          await assertExactBackupArchive(backupFilePath, manifest, manifestText, undefined, "destination");
          removeOwnedFile(stagingPath, stagingIdentity);
          finalized = true;
          await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_finalized", {
            manifestChecksum,
            archiveDigest: stagedArchiveChecksum
          });
          return result;
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
      assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
      await reportBackupCreatePhase(options.onPhase, checkpointContext, "archive_finalized", {
        manifestChecksum,
        archiveDigest: stagedArchiveChecksum
      });
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
      if (stagingIdentity && (cleanupStaging || finalized || !stagingValidated)) {
        removeOwnedFile(stagingPath, stagingIdentity);
      }
    }
  }

  async inspectRestoreArchive(backupPathInput: string): Promise<RestoreCorePreviewResult> {
    const backupPath = path.resolve(backupPathInput);
    const archive = openRestoreArchive(backupPath);
    try {
      const manifest = await readBackupManifest(archive.descriptor);
      const validation = await validateBackupZip(archive.descriptor, manifest);
      await readAndAssertArchivedVaultManifest(archive.descriptor, manifest);
      await readAndAssertArchivedExternalManagedCopies(archive.descriptor, manifest);
      const snapshotAfterValidation = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        archive.initialSnapshot,
        snapshotAfterValidation,
        "The backup changed while its restore preview was created."
      );
      const backupIdentity = resolveBackupIdentity(manifest, snapshotAfterValidation.checksum);
      return {
        backupPath,
        archivePreviewToken: createRestorePreviewToken(backupPath, snapshotAfterValidation),
        archiveDigest: snapshotAfterValidation.checksum,
        archiveSize: snapshotAfterValidation.size,
        backupId: backupIdentity.backupId,
        backupIdSource: backupIdentity.backupIdSource,
        sourceVaultId: manifest.vaultId,
        sourceVaultSchemaVersion: manifest.vaultSchemaVersion,
        manifest: toManifestSummary(manifest),
        invalidFileCount: validation.invalidFiles.length,
        warnings: createPreviewWarnings(manifest, validation.invalidFiles)
      };
    } finally {
      fs.closeSync(archive.descriptor);
    }
  }

  async applyRestore(input: RestoreCoreApplyInput): Promise<RestoreCoreApplyResult> {
    assertRestoreCoreApplyInput(input);
    const backupPath = path.resolve(input.backupPath);
    const destinationCoordinates = captureRestoreDestinationCoordinates(
      input.destinationIdentity.destinationPath,
      input.pathSafety
    );
    assertRestoreDestinationIdentity(input.destinationIdentity, destinationCoordinates);
    const binding = createRestoreApplyBinding(input, destinationCoordinates);
    const archive = openRestoreArchive(backupPath);
    let staging: RestoreStagingHandle | undefined;
    try {
      assertRestorePreviewMatches(backupPath, archive.initialSnapshot, input.archivePreviewToken);
      assertArchiveDigest(archive.initialSnapshot, input.archiveDigest);
      const sourceManifest = await readBackupManifest(archive.descriptor);
      const validation = await validateBackupZip(archive.descriptor, sourceManifest);
      await readAndAssertArchivedVaultManifest(archive.descriptor, sourceManifest);
      await readAndAssertArchivedExternalManagedCopies(archive.descriptor, sourceManifest);
      const snapshotAfterValidation = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        archive.initialSnapshot,
        snapshotAfterValidation,
        "The backup changed after its restore preview."
      );
      assertRestorePreviewMatches(backupPath, snapshotAfterValidation, input.archivePreviewToken);
      assertArchiveDigest(snapshotAfterValidation, input.archiveDigest);
      if (sourceManifest.vaultId !== input.sourceVaultId) {
        throw new PigeDomainError("restore.backup_invalid", "The restore source identity changed after preview.");
      }
      if (validation.invalidFiles.length > 0) {
        throw new PigeDomainError("restore.backup_invalid", "Backup files failed validation.");
      }

      const backupIdentity = resolveBackupIdentity(sourceManifest, snapshotAfterValidation.checksum);
      const checkpointContext = createRestoreCheckpointContext(
        binding,
        backupIdentity,
        countUnresolvedExternalDependencies(sourceManifest)
      );
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "manifest_validated");
      assertCurrentRestoreDestinationCoordinates(destinationCoordinates, input.pathSafety);
      const reservedPublication = reserveRestorePublication(
        destinationCoordinates,
        input.pathSafety,
        binding
      );
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "destination_reserved");
      staging = createRestoreStagingDirectory(
        destinationCoordinates.parentPath,
        destinationCoordinates,
        input.pathSafety,
        binding
      );
      await extractBackupVault(archive.descriptor, sourceManifest, staging);
      const snapshotAfterExtraction = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        snapshotAfterValidation,
        snapshotAfterExtraction,
        "The backup changed while it was restored."
      );
      assertRestorePreviewMatches(backupPath, snapshotAfterExtraction, input.archivePreviewToken);
      assertArchiveDigest(snapshotAfterExtraction, input.archiveDigest);
      assertCurrentRestoreDestinationCoordinates(destinationCoordinates, input.pathSafety);
      assertRestoreStagingIdentity(staging);
      for (const durableRoot of PIGE_DURABLE_ROOTS) {
        ensureRestoreStagingDirectory(path.join(staging.path, durableRoot), staging);
      }
      validateExtractedRestore(staging.path, sourceManifest, [RESTORE_STAGING_MARKER]);
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "archive_extracted");

      materializeExternalManagedCopies(staging, sourceManifest);
      const materializedManifest = materializeRestoreIdentity(
        staging,
        sourceManifest,
        backupIdentity.backupId,
        input.mode,
        input.resultVaultId
      );
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "durable_domains_migrated");
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "external_dependencies_reconciled");
      for (const rebuildableRoot of PIGE_REBUILDABLE_ROOTS) {
        ensureRestoreStagingDirectory(path.join(staging.path, rebuildableRoot), staging);
      }
      for (const runtimeRoot of PIGE_TRANSIENT_RUNTIME_ROOTS) {
        ensureRestoreStagingDirectory(path.join(staging.path, runtimeRoot), staging);
      }
      validateExtractedRestore(staging.path, materializedManifest, [RESTORE_STAGING_MARKER]);
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "vault_identity_finalized");

      const publication = acquireRestorePublication(
        reservedPublication,
        materializedManifest
      );
      publishValidatedRestore(staging.path, materializedManifest, publication);
      await reportRestoreCorePhase(input.onPhase, checkpointContext, "destination_committed");
      releaseRestorePublication(publication);

      return {
        status: "restored",
        restoredVaultPath: destinationCoordinates.destinationPath,
        backupId: backupIdentity.backupId,
        backupIdSource: backupIdentity.backupIdSource,
        archiveDigest: input.archiveDigest,
        mode: input.mode,
        sourceVaultId: input.sourceVaultId,
        resultVaultId: input.resultVaultId,
        destinationIdentity: input.destinationIdentity,
        manifest: toManifestSummary(sourceManifest)
      };
    } finally {
      fs.closeSync(archive.descriptor);
      if (staging) removeOwnedRestoreStagingDirectory(staging);
    }
  }

  async adoptCommittedRestore(input: RestoreCoreApplyInput): Promise<RestoreCoreApplyResult> {
    assertRestoreCoreApplyInput(input);
    const backupPath = path.resolve(input.backupPath);
    const destinationCoordinates = captureRestoreDestinationCoordinates(
      input.destinationIdentity.destinationPath,
      input.pathSafety
    );
    assertRestoreDestinationIdentity(input.destinationIdentity, destinationCoordinates);
    const archive = openRestoreArchive(backupPath);
    try {
      assertRestorePreviewMatches(backupPath, archive.initialSnapshot, input.archivePreviewToken);
      assertArchiveDigest(archive.initialSnapshot, input.archiveDigest);
      const sourceManifest = await readBackupManifest(archive.descriptor);
      const validation = await validateBackupZip(archive.descriptor, sourceManifest);
      const sourceVaultManifest = await readAndAssertArchivedVaultManifest(
        archive.descriptor,
        sourceManifest
      );
      await readAndAssertArchivedExternalManagedCopies(archive.descriptor, sourceManifest);
      const snapshotAfterValidation = snapshotRestoreArchive(archive);
      assertSameRestoreArchive(
        archive.initialSnapshot,
        snapshotAfterValidation,
        "The backup changed while its committed restore was adopted."
      );
      assertRestorePreviewMatches(backupPath, snapshotAfterValidation, input.archivePreviewToken);
      assertArchiveDigest(snapshotAfterValidation, input.archiveDigest);
      if (sourceManifest.vaultId !== input.sourceVaultId || validation.invalidFiles.length > 0) {
        throw new PigeDomainError("restore.backup_invalid", "Committed restore source validation failed.");
      }
      const backupIdentity = resolveBackupIdentity(sourceManifest, snapshotAfterValidation.checksum);
      const materializedManifest = createMaterializedRestoreManifest(
        sourceManifest,
        sourceVaultManifest,
        backupIdentity.backupId,
        input.mode,
        input.resultVaultId
      );
      const binding = createRestoreApplyBinding(input, destinationCoordinates);
      const publication = captureCommittedRestorePublication(
        destinationCoordinates,
        input.pathSafety,
        binding
      );
      assertCurrentRestoreDestinationCoordinates(destinationCoordinates, input.pathSafety);
      validateExtractedRestore(
        destinationCoordinates.destinationPath,
        materializedManifest,
        publication?.markerPath ? [RESTORE_PUBLICATION_MARKER] : []
      );
      assertCurrentRestoreDestinationCoordinates(destinationCoordinates, input.pathSafety);
      if (publication) releaseRestorePublication(publication);
      return {
        status: "restored",
        restoredVaultPath: destinationCoordinates.destinationPath,
        backupId: backupIdentity.backupId,
        backupIdSource: backupIdentity.backupIdSource,
        archiveDigest: input.archiveDigest,
        mode: input.mode,
        sourceVaultId: input.sourceVaultId,
        resultVaultId: input.resultVaultId,
        destinationIdentity: input.destinationIdentity,
        manifest: toManifestSummary(sourceManifest)
      };
    } finally {
      fs.closeSync(archive.descriptor);
    }
  }
}

function createBackupManifest(
  vaultPath: string,
  appVersion: string,
  identity: BackupCreateIdentity,
  preflight: BackupPreflightResult,
  signal?: AbortSignal
): PreparedBackupManifest {
  const vaultManifest = readVaultManifest(vaultPath);
  const preparedFiles = [...preflight.archiveSources.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  ).map(([relativePath, source]) => {
    throwIfBackupAborted(signal);
    assertBackupArchiveSourceFence(source);
    const snapshot = snapshotBackupArchiveSource(source, signal);
    assertBackupArchiveSourceFence(source);
    const preflightChecksum = preflight.sourceRecordChecksums.get(relativePath);
    if (preflightChecksum && snapshot.checksum !== preflightChecksum) {
      throw new PigeDomainError(
        "backup.source_changed",
        "A source record changed after backup preflight."
      );
    }
    if (
      source.expectedChecksum !== undefined &&
      (snapshot.checksum !== source.expectedChecksum || snapshot.size !== source.expectedSize)
    ) {
      throw new PigeDomainError(
        "backup.external_managed_copy_changed",
        "A required external managed source copy changed after capture."
      );
    }
    return {
      path: relativePath,
      size: snapshot.size,
      checksum: snapshot.checksum,
      absolutePath: source.absolutePath,
      identity: snapshot.identity,
      source
    };
  });
  const files = preparedFiles.map(({ absolutePath: _absolutePath, identity: _identity, source: _source, ...file }) => file);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  const manifest = BackupManifestSchema.parse({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: identity.backupId,
    appVersion,
    vaultId: vaultManifest.vault_id,
    vaultName: path.basename(vaultPath),
    vaultSchemaVersion: vaultManifest.vault_schema_version,
    createdAt: identity.createdAt,
    fileCount: files.length,
    totalBytes,
    noteCount: countFiles(path.join(vaultPath, "wiki"), (filePath) => filePath.endsWith(".md")),
    sourceCount: countFiles(path.join(vaultPath, "sources"), (filePath) => filePath.endsWith(".md")),
    conversationCount: countFiles(path.join(vaultPath, ".pige/conversations")),
    memoryCount: countFiles(path.join(vaultPath, ".pige/memory")),
    includesSecrets: false,
    includes: DEFAULT_INCLUDES,
    domainSchemaVersions: preflight.domainSchemaVersions,
    excludedRoots: [...PIGE_REBUILDABLE_ROOTS, ...PIGE_TRANSIENT_RUNTIME_ROOTS],
    externalDependencies: preflight.externalDependencies,
    ...(preflight.externalManagedCopies.length > 0
      ? { externalManagedCopies: preflight.externalManagedCopies }
      : {}),
    files
  });
  return { manifest, files: preparedFiles };
}

function createBackupIdentity(options: BackupCreateOptions): BackupCreateIdentity {
  const createdAt = options.createdAt ?? new Date().toISOString();
  if (
    !Number.isFinite(Date.parse(createdAt)) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(createdAt)
  ) {
    throw new PigeDomainError("backup.identity_invalid", "Backup creation timestamp is invalid.");
  }
  let backupId: string;
  try {
    backupId = BackupIdSchema.parse(options.backupId ?? createBackupId(createdAt));
  } catch {
    throw new PigeDomainError("backup.identity_invalid", "Backup identity is invalid.");
  }
  const stagingOwnerKey = options.stagingOwnerKey ?? options.excludeJobId ?? backupId;
  if (!/^[-A-Za-z0-9._:]{1,256}$/u.test(stagingOwnerKey)) {
    throw new PigeDomainError("backup.identity_invalid", "Backup staging owner identity is invalid.");
  }
  return { backupId, createdAt, stagingOwnerKey };
}

function inspectBackupPreflight(
  vaultPath: string,
  options: BackupCreateOptions,
  userDataPath: string | undefined
): BackupPreflightResult {
  const relativePaths = collectBackupFiles(vaultPath, options);
  const includedPaths = new Set(relativePaths);
  const archiveSources = new Map<string, BackupArchiveSource>(relativePaths.map((relativePath) => [
    relativePath,
    { absolutePath: path.join(vaultPath, ...relativePath.split("/")), kind: "vault" }
  ]));
  const sourceRecordChecksums = new Map<string, string>();
  const externalDependencies: BackupManifest["externalDependencies"] = [];
  const externalManagedCopies: NonNullable<BackupManifest["externalManagedCopies"]> = [];
  const sourceRecordPrefix = ".pige/source-records/";
  const sourceRecords: Array<{
    readonly relativePath: string;
    readonly record: SourceRecord;
    readonly checksum: string;
  }> = [];
  const sourceIds = new Set<string>();
  const requestedRootIds = new Set<string>();

  for (const relativePath of relativePaths) {
    if (!relativePath.startsWith(sourceRecordPrefix) || !relativePath.endsWith(".json")) continue;
    throwIfBackupAborted(options.signal);
    const absolutePath = path.join(vaultPath, ...relativePath.split("/"));
    const inspected = readValidatedBackupSourceRecord(absolutePath);
    const record = inspected.record;
    if (sourceIds.has(record.id)) {
      throw new PigeDomainError("backup.source_record_conflict", "Backup contains duplicate SourceRecord IDs.");
    }
    sourceIds.add(record.id);
    sourceRecords.push({ relativePath, record, checksum: inspected.checksum });
    sourceRecordChecksums.set(relativePath, inspected.checksum);

    const rootId = record.managedCopy?.rootId;
    if (rootId && rootId !== "root_vault_managed") requestedRootIds.add(rootId);
  }

  const roots = readExternalManagedCopyRoots(userDataPath, readVaultManifest(vaultPath).vault_id, requestedRootIds);
  const externalLocators = new Set<string>();
  const includedRootIds = new Set<string>();

  for (const inspected of sourceRecords) {
    const { relativePath, record } = inspected;

    if (record.storageStrategy === "reference_original") {
      externalDependencies.push({
        kind: "external_original",
        sourceId: record.id,
        included: false,
        requiredForCompleteRestore: false
      });
      continue;
    }

    const managedCopy = record.managedCopy;
    if (!managedCopy) {
      throw new PigeDomainError("backup.source_record_invalid", "A managed source record has no managed copy.");
    }
    if (managedCopy.rootId && managedCopy.rootId !== "root_vault_managed") {
      assertSafeVaultRelativePath(managedCopy.path);
      const root = roots.get(managedCopy.rootId);
      if (!root) {
        throw new BackupManagedCopyDependencyError(
          "backup.external_managed_copy_root_missing",
          "A required external managed-copy root must be reconnected before backup.",
          "vault_binding",
          managedCopy.rootId
        );
      }
      const locatorKey = `${managedCopy.rootId}\0${managedCopy.path}`;
      if (externalLocators.has(locatorKey)) {
        throw new PigeDomainError(
          "backup.external_managed_copy_conflict",
          "Multiple SourceRecords resolve to the same external managed-copy locator."
        );
      }
      externalLocators.add(locatorKey);
      const externalSource = captureExternalManagedCopySource(root, managedCopy.path, record.id);
      const archivePath = externalManagedCopyArchivePath(record.id, managedCopy.rootId, managedCopy.checksum);
      const restorePath = externalManagedCopyRestorePath(record.id, managedCopy.rootId, managedCopy.checksum);
      if (archiveSources.has(archivePath) || archiveSources.has(restorePath) || includedPaths.has(restorePath)) {
        throw new PigeDomainError(
          "backup.external_managed_copy_mapping_collision",
          "An external managed-copy archive mapping collides with durable vault data."
        );
      }
      const restoredRecord = createRestoredExternalSourceRecord(record, restorePath);
      const restoredRecordBytes = Buffer.from(`${JSON.stringify(restoredRecord, null, 2)}\n`, "utf8");
      archiveSources.set(archivePath, {
        ...externalSource,
        kind: "external_managed_copy",
        expectedChecksum: managedCopy.checksum,
        expectedSize: managedCopy.size,
        sourceId: record.id
      });
      externalManagedCopies.push({
        sourceId: record.id,
        rootId: managedCopy.rootId,
        sourceRecordPath: relativePath,
        archivePath,
        restorePath,
        checksum: managedCopy.checksum,
        size: managedCopy.size,
        restoredSourceRecordChecksum: checksumBuffer(restoredRecordBytes),
        restoredSourceRecordSize: restoredRecordBytes.byteLength
      });
      includedRootIds.add(managedCopy.rootId);
      continue;
    }
    assertSafeVaultRelativePath(managedCopy.path);
    if (!includedPaths.has(managedCopy.path)) {
      throw new PigeDomainError(
        "backup.managed_copy_missing",
        "A required in-vault managed source copy is unavailable."
      );
    }
  }

  for (const rootId of [...includedRootIds].sort()) {
    externalDependencies.push({
      kind: "external_managed_copy_root",
      rootId,
      included: true,
      requiredForCompleteRestore: false
    });
  }

  externalDependencies.sort((left, right) => {
    const leftId = typeof left === "string" ? left : `${left.kind}:${left.sourceId ?? left.rootId ?? ""}`;
    const rightId = typeof right === "string" ? right : `${right.kind}:${right.sourceId ?? right.rootId ?? ""}`;
    return leftId.localeCompare(rightId);
  });

  return {
    relativePaths,
    archiveSources,
    sourceRecordChecksums,
    domainSchemaVersions: deriveBackupDomainSchemaVersions(vaultPath, relativePaths),
    externalDependencies,
    externalManagedCopies: externalManagedCopies.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  };
}

function captureExternalManagedCopySource(
  root: VerifiedExternalManagedCopyRoot,
  relativePath: string,
  sourceId: string
): BackupArchiveSource {
  assertExternalManagedCopyRootIdentity(root);
  assertSafeVaultRelativePath(relativePath);
  const absolutePath = path.resolve(root.absolutePath, ...relativePath.split("/"));
  if (!isSameOrInside(absolutePath, root.absolutePath) || absolutePath === root.absolutePath) {
    throw new PigeDomainError(
      "backup.external_managed_copy_path_invalid",
      "An external managed-copy locator escapes its bound root."
    );
  }

  const parentIdentities: ExternalManagedCopyRootIdentity[] = [];
  let current = root.absolutePath;
  const segments = relativePath.split("/");
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    let identity: fs.Stats;
    try {
      identity = fs.lstatSync(current);
    } catch {
      throw new BackupManagedCopyDependencyError(
        "backup.external_managed_copy_missing",
        "A required external managed source copy is unavailable.",
        "external_source",
        sourceId
      );
    }
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw new PigeDomainError(
        "backup.external_managed_copy_path_invalid",
        "An external managed-copy locator contains a symbolic-link or non-directory parent."
      );
    }
    parentIdentities.push({ path: current, device: identity.dev, inode: identity.ino });
  }

  let fileIdentity: fs.Stats;
  try {
    fileIdentity = fs.lstatSync(absolutePath);
  } catch {
    throw new BackupManagedCopyDependencyError(
      "backup.external_managed_copy_missing",
      "A required external managed source copy is unavailable.",
      "external_source",
      sourceId
    );
  }
  if (!fileIdentity.isFile() || fileIdentity.isSymbolicLink() || fileIdentity.nlink !== 1) {
    throw new PigeDomainError(
      "backup.external_managed_copy_path_invalid",
      "An external managed-copy locator is not a private regular file."
    );
  }
  let canonicalFile: string;
  try {
    canonicalFile = fs.realpathSync.native(absolutePath);
  } catch {
    throw new BackupManagedCopyDependencyError(
      "backup.external_managed_copy_missing",
      "A required external managed source copy is unavailable.",
      "external_source",
      sourceId
    );
  }
  if (canonicalFile !== absolutePath) {
    throw new PigeDomainError(
      "backup.external_managed_copy_path_invalid",
      "An external managed-copy locator resolves through a symbolic link."
    );
  }
  assertExternalManagedCopyRootIdentity(root);
  return { absolutePath, kind: "external_managed_copy", sourceId, root, parentIdentities };
}

function assertBackupArchiveSourceFence(source: BackupArchiveSource): void {
  if (source.kind !== "external_managed_copy") return;
  if (!source.root || !source.parentIdentities) {
    throw new PigeDomainError("backup.root_binding_invalid", "An external managed-copy fence is incomplete.");
  }
  assertExternalManagedCopyRootIdentity(source.root);
  for (const expected of source.parentIdentities) {
    let current: fs.Stats;
    try {
      current = fs.lstatSync(expected.path);
    } catch {
      throw new PigeDomainError(
        "backup.external_managed_copy_root_changed",
        "An external managed-copy parent changed during backup."
      );
    }
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== expected.device ||
      current.ino !== expected.inode
    ) {
      throw new PigeDomainError(
        "backup.external_managed_copy_root_changed",
        "An external managed-copy parent changed during backup."
      );
    }
  }
}

function assertPreparedBackupFile(file: PreparedBackupFile): void {
  assertBackupArchiveSourceFence(file.source);
  let current: fs.Stats;
  try {
    current = fs.lstatSync(file.absolutePath);
  } catch {
    if (file.source.kind === "external_managed_copy" && file.source.sourceId) {
      throw new BackupManagedCopyDependencyError(
        "backup.external_managed_copy_missing",
        "A required external managed source copy is unavailable.",
        "external_source",
        file.source.sourceId
      );
    }
    throw new PigeDomainError("backup.source_changed", "A backup source file became unavailable.");
  }
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.nlink !== 1 ||
    !sameFileRevision(file.identity, current)
  ) {
    throw new PigeDomainError("backup.source_changed", "A backup source file changed before archive finalization.");
  }
}

function createVerifiedBackupReadStream(
  file: PreparedBackupFile,
  signal?: AbortSignal
): Readable {
  assertPreparedBackupFile(file);
  throwIfBackupAborted(signal);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file.absolutePath, flags);
  let closed = false;
  let reading = false;
  let bytesRead = 0;
  const hash = createHash("sha256");

  const closeDescriptor = (): void => {
    if (closed) return;
    closed = true;
    fs.closeSync(descriptor);
  };

  try {
    const opened = fs.fstatSync(descriptor);
    const pathIdentity = fs.lstatSync(file.absolutePath);
    if (
      opened.nlink !== 1 ||
      pathIdentity.nlink !== 1 ||
      !sameFileRevision(file.identity, opened) ||
      !sameFileRevision(opened, pathIdentity)
    ) {
      throw new PigeDomainError(
        "backup.source_changed",
        "A backup source file changed before archive streaming began."
      );
    }
    assertBackupArchiveSourceFence(file.source);
  } catch (caught) {
    closeDescriptor();
    throw caught;
  }

  const stream = new Readable({
    read(requestedSize) {
      if (reading || closed) return;
      try {
        throwIfBackupAborted(signal);
      } catch (caught) {
        this.destroy(caught instanceof Error ? caught : new Error("Backup creation was cancelled."));
        return;
      }
      reading = true;
      const buffer = Buffer.alloc(Math.min(Math.max(requestedSize, 64 * 1024), 1024 * 1024));
      fs.read(descriptor, buffer, 0, buffer.length, null, (caught, count) => {
        reading = false;
        if (caught) {
          this.destroy(caught);
          return;
        }
        if (count > 0) {
          bytesRead += count;
          hash.update(buffer.subarray(0, count));
          this.push(buffer.subarray(0, count));
          return;
        }
        try {
          const after = fs.fstatSync(descriptor);
          const pathAfter = fs.lstatSync(file.absolutePath);
          const checksum = `sha256:${hash.digest("hex")}`;
          if (
            after.nlink !== 1 ||
            pathAfter.nlink !== 1 ||
            !sameFileRevision(file.identity, after) ||
            !sameFileRevision(after, pathAfter) ||
            bytesRead !== file.size ||
            checksum !== file.checksum
          ) {
            throw new PigeDomainError(
              "backup.source_changed",
              "A backup source file changed while it was archived."
            );
          }
          assertBackupArchiveSourceFence(file.source);
          closeDescriptor();
          this.push(null);
        } catch (verificationError) {
          this.destroy(
            verificationError instanceof Error
              ? verificationError
              : new Error("Backup source verification failed.")
          );
        }
      });
    },
    destroy(caught, callback) {
      try {
        closeDescriptor();
        callback(caught);
      } catch (closeError) {
        callback(closeError instanceof Error ? closeError : new Error("Backup source close failed."));
      }
    }
  });

  if (signal) {
    const abort = (): void => {
      try {
        throwIfBackupAborted(signal);
      } catch (caught) {
        stream.destroy(caught instanceof Error ? caught : new Error("Backup creation was cancelled."));
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => signal.removeEventListener("abort", abort));
  }
  return stream;
}

function snapshotBackupArchiveSource(
  source: BackupArchiveSource,
  signal?: AbortSignal
): { readonly size: number; readonly checksum: string; readonly identity: fs.Stats } {
  try {
    return snapshotBackupSourceFile(source.absolutePath, signal);
  } catch (caught) {
    if (
      source.kind === "external_managed_copy" &&
      source.sourceId &&
      !(caught instanceof PigeDomainError)
    ) {
      throw new BackupManagedCopyDependencyError(
        "backup.external_managed_copy_missing",
        "A required external managed source copy is unavailable.",
        "external_source",
        source.sourceId
      );
    }
    throw caught;
  }
}

function externalManagedCopyArchivePath(sourceId: string, rootId: string, checksum: string): string {
  return `.pige/backup-managed-copies/${rootId}/${sourceId}/${checksum.slice("sha256:".length)}.bin`;
}

function externalManagedCopyRestorePath(sourceId: string, rootId: string, checksum: string): string {
  return `raw/restored-managed-copies/${rootId}/${sourceId}/${checksum.slice("sha256:".length)}.bin`;
}

function createRestoredExternalSourceRecord(record: SourceRecord, restorePath: string): SourceRecord {
  if (!record.managedCopy) {
    throw new PigeDomainError("backup.source_record_invalid", "A managed source record has no managed copy.");
  }
  return SourceRecordSchema.parse({
    ...record,
    managedCopy: {
      ...record.managedCopy,
      rootId: "root_vault_managed",
      pathBasis: "vault_relative",
      path: restorePath
    }
  });
}

type BackupDomainName = keyof BackupDomainSchemaVersions;

function deriveBackupDomainSchemaVersions(
  vaultPath: string,
  relativePaths: readonly string[]
): BackupDomainSchemaVersions {
  const versions = new Map<BackupDomainName, Set<number>>();
  const domainNames: readonly BackupDomainName[] = [
    "markdownPages",
    "sourceRecords",
    "conversationEvents",
    "jobs",
    "proposals",
    "operations",
    "memory",
    "skills",
    "datasets"
  ];
  for (const domain of domainNames) versions.set(domain, new Set());

  for (const relativePath of relativePaths) {
    const domain = durableDomainForPath(relativePath);
    if (!domain) continue;
    const absolutePath = path.join(vaultPath, ...relativePath.split("/"));
    for (const version of readDurableDomainVersions(absolutePath, domain)) {
      versions.get(domain)!.add(version);
    }
  }

  return BackupDomainSchemaVersionsSchema.parse(Object.fromEntries(domainNames.map((domain) => {
    const recorded = [...versions.get(domain)!].sort((left, right) => left - right);
    const present = recorded.length > 0 ? recorded : [1];
    return [domain, { min: present[0]!, max: present[present.length - 1]! }];
  })));
}

function durableDomainForPath(relativePath: string): BackupDomainName | undefined {
  if ((relativePath.startsWith("wiki/") || relativePath.startsWith("sources/")) && relativePath.endsWith(".md")) {
    return "markdownPages";
  }
  if (relativePath.startsWith(".pige/source-records/") && relativePath.endsWith(".json")) {
    return "sourceRecords";
  }
  if (relativePath.startsWith(".pige/conversations/") && relativePath.endsWith(".jsonl")) {
    return "conversationEvents";
  }
  if (relativePath.startsWith(".pige/jobs/") && relativePath.endsWith(".json")) return "jobs";
  if (relativePath.startsWith(".pige/proposals/") && relativePath.endsWith(".json")) return "proposals";
  if (relativePath.startsWith(".pige/operations/") && relativePath.endsWith(".json")) return "operations";
  if (relativePath.startsWith(".pige/memory/") && /\.(?:json|md)$/u.test(relativePath)) return "memory";
  if (relativePath.startsWith(".pige/skills/") && /\.(?:json|md)$/u.test(relativePath)) return "skills";
  if (relativePath.startsWith("datasets/") && relativePath.endsWith(".json")) return "datasets";
  return undefined;
}

function readDurableDomainVersions(
  absolutePath: string,
  domain: BackupDomainName
): readonly number[] {
  try {
    const body = fs.readFileSync(absolutePath, "utf8");
    if (domain === "markdownPages" || absolutePath.endsWith(".md")) {
      const version = parsePigeFrontmatter(body)?.frontmatter.schema_version;
      return version === undefined ? [1] : [parseDurableSchemaVersion(version)];
    }
    if (domain === "conversationEvents") {
      const values = body.split(/\r?\n/gu).filter((line) => line.trim() !== "");
      return values.length === 0
        ? [1]
        : values.map((line) => readJsonSchemaVersion(JSON.parse(line) as unknown));
    }
    return [readJsonSchemaVersion(JSON.parse(body) as unknown)];
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "backup.schema_version_invalid",
      `A ${domain} record has invalid schema-version structure.`
    );
  }
}

function readJsonSchemaVersion(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PigeDomainError("backup.schema_version_invalid", "A durable JSON record must be an object.");
  }
  return parseDurableSchemaVersion((value as Record<string, unknown>).schemaVersion ?? 1);
}

function parseDurableSchemaVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PigeDomainError("backup.schema_version_invalid", "A durable schema version is invalid.");
  }
  return value;
}

function readValidatedBackupSourceRecord(filePath: string): {
  readonly record: SourceRecord;
  readonly checksum: string;
} {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, flags);
    const before = fs.fstatSync(descriptor);
    const pathBefore = fs.lstatSync(filePath);
    if (before.nlink !== 1 || pathBefore.nlink !== 1 || !sameFileRevision(before, pathBefore)) {
      throw new PigeDomainError("backup.source_changed", "A source record changed during backup preflight.");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (!sameFileRevision(before, after) || !sameFileRevision(after, pathAfter)) {
      throw new PigeDomainError("backup.source_changed", "A source record changed during backup preflight.");
    }
    return {
      record: SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown),
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "backup.source_record_invalid",
      "A source record is not compatible with durable backup."
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function createRestoreDestinationIdentity(
  destinationPathInput: string,
  pathSafety: VaultPathSafetyOptions
): RestoreDestinationIdentity {
  const coordinates = captureRestoreDestinationCoordinates(destinationPathInput, pathSafety);
  return {
    destinationPath: coordinates.destinationPath,
    parentPath: coordinates.parentPath,
    identityDigest: coordinates.identityDigest
  };
}

function collectBackupFiles(
  vaultPath: string,
  options: BackupCreateOptions = {}
): readonly string[] {
  const files = new Set<string>();
  const excludedJobPath = options.excludeJobId
    ? backupJobRelativePath(options.excludeJobId)
    : undefined;
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

  for (const file of Array.from(files)) {
    if (isHistoricalBackupJob(vaultPath, file)) files.delete(file);
  }

  if (excludedJobPath) files.delete(excludedJobPath);

  return Array.from(files).sort();
}

function isHistoricalBackupJob(vaultPath: string, relativePath: string): boolean {
  if (!relativePath.startsWith(".pige/jobs/") || !relativePath.endsWith(".json")) return false;
  try {
    const filePath = path.join(vaultPath, ...relativePath.split("/"));
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return Boolean(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).class === "backup"
    );
  } catch {
    return false;
  }
}

function backupJobRelativePath(jobIdInput: string): string {
  const jobId = JobIdSchema.parse(jobIdInput);
  const date = /^job_(\d{4})(\d{2})\d{2}_/u.exec(jobId);
  if (!date) throw new PigeDomainError("backup.job_invalid", "Excluded Backup Job identity is invalid.");
  return `.pige/jobs/${date[1]}/${date[2]}/${jobId}.json`;
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
  let manifest: BackupManifest;
  try {
    manifest = BackupManifestSchema.parse(value);
  } catch {
    throw new PigeDomainError("restore.manifest_invalid", "Backup manifest is not compatible.");
  }
  const manifestPaths = new Set<string>();
  for (const file of manifest.files) {
    assertSafeVaultRelativePath(file.path);
    if (manifestPaths.has(file.path)) {
      throw new PigeDomainError("restore.entry_duplicate", "Backup manifest contains duplicate file entries.");
    }
    manifestPaths.add(file.path);
  }
  assertExternalManagedCopyManifestShape(manifest, manifestPaths);
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
  if (manifest.fileCount !== manifest.files.length || manifest.totalBytes !== totalBytes) {
    throw new PigeDomainError("restore.manifest_invalid", "Backup manifest file totals are inconsistent.");
  }
  return manifest;
}

function assertExternalManagedCopyManifestShape(
  manifest: BackupManifest,
  manifestPaths: ReadonlySet<string>
): void {
  const mappings = manifest.externalManagedCopies ?? [];
  const sourceIds = new Set<string>();
  const sourceRecordPaths = new Set<string>();
  const archivePaths = new Set<string>();
  const restorePaths = new Set<string>();
  const dependencyRootIds = new Set<string>();
  const includedRootIds = new Set<string>();

  for (const dependency of manifest.externalDependencies) {
    if (typeof dependency === "string" || dependency.kind !== "external_managed_copy_root") continue;
    if (!dependency.rootId || dependencyRootIds.has(dependency.rootId)) {
      throw new PigeDomainError("restore.manifest_invalid", "Backup contains conflicting external root dependencies.");
    }
    dependencyRootIds.add(dependency.rootId);
    if (dependency.included) {
      if (dependency.requiredForCompleteRestore) {
        throw new PigeDomainError(
          "restore.manifest_invalid",
          "An included external root cannot remain required for complete restore."
        );
      }
      includedRootIds.add(dependency.rootId);
    }
  }

  for (const mapping of mappings) {
    assertSafeVaultRelativePath(mapping.sourceRecordPath);
    assertSafeVaultRelativePath(mapping.archivePath);
    assertSafeVaultRelativePath(mapping.restorePath);
    if (
      mapping.sourceRecordPath === mapping.archivePath ||
      mapping.sourceRecordPath === mapping.restorePath ||
      mapping.archivePath === mapping.restorePath ||
      sourceIds.has(mapping.sourceId) ||
      sourceRecordPaths.has(mapping.sourceRecordPath) ||
      archivePaths.has(mapping.archivePath) ||
      restorePaths.has(mapping.restorePath)
    ) {
      throw new PigeDomainError("restore.manifest_invalid", "Backup contains duplicate managed-copy mappings.");
    }
    if (
      !mapping.sourceRecordPath.startsWith(".pige/source-records/") ||
      !mapping.sourceRecordPath.endsWith(".json") ||
      mapping.archivePath !== externalManagedCopyArchivePath(mapping.sourceId, mapping.rootId, mapping.checksum) ||
      mapping.restorePath !== externalManagedCopyRestorePath(mapping.sourceId, mapping.rootId, mapping.checksum) ||
      !manifestPaths.has(mapping.sourceRecordPath) ||
      !manifestPaths.has(mapping.archivePath) ||
      manifestPaths.has(mapping.restorePath) ||
      !includedRootIds.has(mapping.rootId)
    ) {
      throw new PigeDomainError("restore.manifest_invalid", "Backup managed-copy mapping is incomplete or unsafe.");
    }
    const archiveFile = manifest.files.find((file) => file.path === mapping.archivePath);
    if (!archiveFile || archiveFile.checksum !== mapping.checksum || archiveFile.size !== mapping.size) {
      throw new PigeDomainError("restore.manifest_invalid", "Backup managed-copy payload metadata is inconsistent.");
    }
    sourceIds.add(mapping.sourceId);
    sourceRecordPaths.add(mapping.sourceRecordPath);
    archivePaths.add(mapping.archivePath);
    restorePaths.add(mapping.restorePath);
  }

  for (const rootId of includedRootIds) {
    if (!mappings.some((mapping) => mapping.rootId === rootId)) {
      throw new PigeDomainError("restore.manifest_invalid", "An included external root has no managed-copy mapping.");
    }
  }
}

async function readAndAssertArchivedVaultManifest(
  source: string | number,
  manifest: BackupManifest
): Promise<VaultManifest> {
  requireRestoreManifestFile(manifest, RESTORE_COMMIT_ENTRY);
  const manifestText = await readZipTextEntry(source, `${BACKUP_VAULT_DIR}/${RESTORE_COMMIT_ENTRY}`);
  if (!manifestText) {
    throw new PigeDomainError("restore.backup_invalid", "Backup vault manifest is missing.");
  }
  let vaultManifest: VaultManifest;
  try {
    vaultManifest = VaultManifestSchema.parse(JSON.parse(manifestText) as unknown);
  } catch {
    throw new PigeDomainError("restore.backup_invalid", "Backup vault manifest is not compatible.");
  }
  if (
    vaultManifest.vault_id !== manifest.vaultId ||
    vaultManifest.vault_schema_version !== manifest.vaultSchemaVersion
  ) {
    throw new PigeDomainError("restore.backup_invalid", "Backup manifest identity does not match the archived vault.");
  }
  return vaultManifest;
}

async function readAndAssertArchivedExternalManagedCopies(
  source: string | number,
  manifest: BackupManifest
): Promise<void> {
  const mappings = manifest.externalManagedCopies ?? [];
  if (mappings.length === 0) return;
  const pending = new Map(mappings.map((mapping) => [
    `${BACKUP_VAULT_DIR}/${mapping.sourceRecordPath}`,
    mapping
  ]));
  const zipFile = await openBackupZip(source);
  try {
    for await (const entry of zipFile.eachEntry()) {
      assertSafeZipEntryName(entry.fileName);
      const mapping = pending.get(entry.fileName);
      if (!mapping) continue;
      const sourceRecordBytes = await readZipEntryBuffer(zipFile, entry);
      assertArchivedExternalManagedCopySourceRecord(sourceRecordBytes, mapping);
      pending.delete(entry.fileName);
    }
  } finally {
    zipFile.close();
  }
  if (pending.size > 0) {
    throw new PigeDomainError("restore.backup_invalid", "A mapped SourceRecord is missing from backup.");
  }
}

function assertArchivedExternalManagedCopySourceRecord(
  sourceRecordBytes: Buffer,
  mapping: NonNullable<BackupManifest["externalManagedCopies"]>[number]
): void {
  let record: SourceRecord;
  try {
    record = SourceRecordSchema.parse(JSON.parse(sourceRecordBytes.toString("utf8")) as unknown);
  } catch {
    throw new PigeDomainError("restore.backup_invalid", "A mapped SourceRecord is incompatible.");
  }
  if (
    record.id !== mapping.sourceId ||
    record.storageStrategy !== "copy_to_source_library" ||
    record.managedCopy?.rootId !== mapping.rootId ||
    record.managedCopy.pathBasis !== "root_relative" ||
    record.managedCopy.checksum !== mapping.checksum ||
    record.managedCopy.size !== mapping.size
  ) {
    throw new PigeDomainError("restore.backup_invalid", "A managed-copy mapping conflicts with its SourceRecord.");
  }
  assertSafeVaultRelativePath(record.managedCopy.path);
  const restoredRecord = createRestoredExternalSourceRecord(record, mapping.restorePath);
  const restoredBytes = Buffer.from(`${JSON.stringify(restoredRecord, null, 2)}\n`, "utf8");
  if (
    restoredBytes.byteLength !== mapping.restoredSourceRecordSize ||
    checksumBuffer(restoredBytes) !== mapping.restoredSourceRecordChecksum
  ) {
    throw new PigeDomainError("restore.backup_invalid", "A restored SourceRecord mapping is not deterministic.");
  }
}

function createBackupId(createdAt: string): string {
  const date = createdAt.slice(0, 10).replaceAll("-", "");
  return BackupIdSchema.parse(`backup_${date}_${randomUUID().replaceAll("-", "").slice(0, 16)}`);
}

function resolveBackupIdentity(manifest: BackupManifest, archiveDigest: string): ResolvedBackupIdentity {
  if (manifest.backupId) {
    return { backupId: manifest.backupId, backupIdSource: "manifest" };
  }
  const date = manifest.createdAt.slice(0, 10).replaceAll("-", "");
  const suffix = createHash("sha256")
    .update("pige:legacy-backup-lineage:v1\0", "utf8")
    .update(archiveDigest, "utf8")
    .update("\0", "utf8")
    .update(manifest.createdAt, "utf8")
    .digest("hex");
  return {
    backupId: BackupIdSchema.parse(`backup_${date}_${suffix}`),
    backupIdSource: "derived_legacy"
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
  manifest: BackupManifest,
  signal?: AbortSignal
): Promise<{ readonly invalidFiles: readonly string[] }> {
  const invalidFiles = new Set<string>();
  const manifestFilesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const seenManifestFiles = new Set<string>();
  const seenEntryNames = new Set<string>();
  let manifestEntryCount = 0;
  const zipFile = await openBackupZip(source);
  try {
    for await (const entry of zipFile.eachEntry()) {
      throwIfBackupAborted(signal);
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
      const checksum = await checksumZipEntry(zipFile, entry, signal);
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

async function assertExactBackupArchive(
  archivePath: string,
  expectedManifest: BackupManifest,
  expectedManifestText: string,
  signal: AbortSignal | undefined,
  kind: "destination" | "existing_staging" | "staging"
): Promise<fs.Stats> {
  try {
    throwIfBackupAborted(signal);
    const before = fs.lstatSync(archivePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.nlink > 2) {
      throw new Error("Backup archive identity is not private.");
    }
    const manifestText = await readZipTextEntry(archivePath, BACKUP_MANIFEST_FILE);
    if (manifestText !== expectedManifestText) {
      throw new Error("Backup manifest does not match the requested identity and source snapshot.");
    }
    const parsedManifest = parseBackupManifest(JSON.parse(manifestText) as unknown);
    if (JSON.stringify(parsedManifest) !== JSON.stringify(expectedManifest)) {
      throw new Error("Backup manifest is not the exact expected manifest.");
    }
    const validation = await validateBackupZip(archivePath, parsedManifest, signal);
    if (validation.invalidFiles.length > 0) {
      throw new Error("Backup archive files do not match the expected manifest.");
    }
    await readAndAssertArchivedVaultManifest(archivePath, parsedManifest);
    await readAndAssertArchivedExternalManagedCopies(archivePath, parsedManifest);
    throwIfBackupAborted(signal);
    const after = fs.lstatSync(archivePath);
    if (!sameFileRevision(before, after)) {
      throw new Error("Backup archive changed during validation.");
    }
    return after;
  } catch (caught) {
    if (signal?.aborted) throwIfBackupAborted(signal);
    if (kind === "destination") {
      throw new PigeDomainError(
        "backup.destination_exists",
        "Backup destination already contains a different file."
      );
    }
    if (kind === "existing_staging") {
      throw new PigeDomainError(
        "backup.staging_conflict",
        "Backup staging contains output for a different identity or source snapshot."
      );
    }
    throw new PigeDomainError("backup.validation_failed", "Staged backup files failed validation.");
  }
}

async function inspectAdoptableBackupArchive(
  archivePath: string,
  identity: BackupCreateIdentity,
  vaultId: string,
  appVersion: string,
  options: BackupCreateOptions,
  kind: "destination" | "existing_staging"
): Promise<AdoptedBackupArchive> {
  try {
    const before = fs.lstatSync(archivePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.nlink > 2) {
      throw new Error("Backup archive identity is unsafe.");
    }
    const manifestText = await readZipTextEntry(archivePath, BACKUP_MANIFEST_FILE);
    if (manifestText === undefined) {
      throw new Error("Backup manifest is missing.");
    }
    const manifest = parseBackupManifest(JSON.parse(manifestText) as unknown);
    if (
      manifest.backupId !== identity.backupId ||
      manifest.createdAt !== identity.createdAt ||
      manifest.vaultId !== vaultId ||
      manifest.appVersion !== appVersion
    ) {
      throw new Error("Backup archive identity does not match its durable Job.");
    }
    const manifestChecksum = checksumBuffer(Buffer.from(manifestText, "utf8"));
    if (
      options.expectedManifestChecksum !== undefined &&
      manifestChecksum !== options.expectedManifestChecksum
    ) {
      throw new Error("Backup manifest digest changed after its durable checkpoint.");
    }
    const validation = await validateBackupZip(archivePath, manifest);
    if (validation.invalidFiles.length > 0) {
      throw new Error("Backup archive files do not match its manifest.");
    }
    await readAndAssertArchivedVaultManifest(archivePath, manifest);
    await readAndAssertArchivedExternalManagedCopies(archivePath, manifest);
    const archiveDigest = checksumFile(archivePath) as `sha256:${string}`;
    if (
      options.expectedArchiveDigest !== undefined &&
      archiveDigest !== options.expectedArchiveDigest
    ) {
      throw new Error("Backup archive digest changed after its durable checkpoint.");
    }
    const after = fs.lstatSync(archivePath);
    if (!sameFileRevision(before, after)) {
      throw new Error("Backup archive changed during recovery validation.");
    }
    return { manifest, manifestChecksum, archiveDigest, identity: after };
  } catch (caught) {
    if (kind === "destination") {
      throw new PigeDomainError("backup.destination_exists", "Backup destination contains conflicting output.");
    }
    throw new PigeDomainError("backup.staging_conflict", "Backup staging conflicts with its durable checkpoint.");
  }
}

function assertDurableAdoptionDigests(
  options: BackupCreateOptions,
  kind: "destination" | "existing_staging"
): void {
  if (kind === "destination") {
    if (options.expectedManifestChecksum) return;
    throw new PigeDomainError(
      "backup.destination_exists",
      "Backup destination has no matching durable archive checkpoint."
    );
  }
  if (options.expectedManifestChecksum) return;
  throw new PigeDomainError(
    "backup.staging_conflict",
    "Backup staging has no matching durable manifest checkpoint."
  );
}

async function reportAdoptedBackupPhases(
  reporter: BackupCreatePhaseReporter | undefined,
  context: Pick<BackupCreateCheckpointEvent, "backupId" | "createdAt" | "stagingOwnerKey">,
  adopted: AdoptedBackupArchive,
  finalized = true
): Promise<void> {
  await reportBackupCreatePhase(reporter, context, "preflight");
  await reportBackupCreatePhase(reporter, context, "manifest_written", {
    manifestChecksum: adopted.manifestChecksum
  });
  await reportBackupCreatePhase(reporter, context, "files_hashed", {
    manifestChecksum: adopted.manifestChecksum
  });
  await reportBackupCreatePhase(reporter, context, "archive_staged", {
    manifestChecksum: adopted.manifestChecksum,
    archiveDigest: adopted.archiveDigest
  });
  if (finalized) {
    await reportBackupCreatePhase(reporter, context, "archive_finalized", {
      manifestChecksum: adopted.manifestChecksum,
      archiveDigest: adopted.archiveDigest
    });
  }
}

function publishAdoptedBackupStaging(
  stagingPath: string,
  backupFilePath: string,
  adopted: AdoptedBackupArchive,
  destinationParentIdentity: fs.Stats
): void {
  let linked = false;
  try {
    try {
      assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
      fs.linkSync(stagingPath, backupFilePath);
      linked = true;
    } catch (caught) {
      if (isErrno(caught, "EEXIST")) {
        const destinationDigest = checksumFile(backupFilePath);
        if (destinationDigest !== adopted.archiveDigest) {
          throw new PigeDomainError("backup.destination_exists", "Backup destination contains conflicting output.");
        }
        removeOwnedFile(stagingPath, adopted.identity);
        return;
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
    const staging = fs.lstatSync(stagingPath);
    const destination = fs.lstatSync(backupFilePath);
    if (
      staging.nlink !== 2 ||
      destination.nlink !== 2 ||
      !sameFileDataRevision(adopted.identity, staging) ||
      !sameFileDataRevision(staging, destination) ||
      checksumFile(backupFilePath) !== adopted.archiveDigest
    ) {
      throw new PigeDomainError("backup.finalization_failed", "Backup archive changed during finalization.");
    }
    fsyncDirectoryIfSupported(path.dirname(backupFilePath));
    fs.rmSync(stagingPath);
    const finalized = fs.lstatSync(backupFilePath);
    if (finalized.nlink !== 1 || !sameFileDataRevision(destination, finalized)) {
      throw new PigeDomainError("backup.finalization_failed", "Backup archive did not finalize privately.");
    }
    fsyncDirectoryBestEffort(path.dirname(backupFilePath));
    assertBackupDestinationParent(backupFilePath, destinationParentIdentity);
  } catch (caught) {
    if (linked) removeOwnedFile(backupFilePath, adopted.identity);
    throw caught;
  }
}

async function extractBackupVault(
  source: string | number,
  manifest: BackupManifest,
  staging: RestoreStagingHandle
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
      const targetPath = resolveRestoreTarget(staging.path, relativePath);
      ensureRestoreStagingDirectory(path.dirname(targetPath), staging);
      assertRestoreStagingIdentity(staging);
      try {
        await pipeline(await zipFile.openReadStreamPromise(entry), fs.createWriteStream(targetPath, { flags: "wx" }));
      } catch (caught) {
        assertRestoreStagingIdentity(staging);
        throw caught;
      }
      assertRestoreStagingIdentity(staging);
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

async function checksumZipEntry(
  zipFile: { openReadStreamPromise: (entry: Entry) => Promise<NodeJS.ReadableStream> },
  entry: Entry,
  signal?: AbortSignal
): Promise<string> {
  const hash = createHash("sha256");
  const stream = await zipFile.openReadStreamPromise(entry);
  for await (const chunk of stream) {
    throwIfBackupAborted(signal);
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

function checksumBuffer(value: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

function assertArchiveDigest(snapshot: RestoreArchiveSnapshot, expectedDigest: string): void {
  if (snapshot.checksum !== expectedDigest) {
    throw new PigeDomainError("restore.backup_invalid", "The backup digest no longer matches its restore preview.");
  }
}

function assertRestoreCoreApplyInput(input: RestoreCoreApplyInput): void {
  assertRestorePreviewToken(input.archivePreviewToken);
  if (!RESTORE_PREVIEW_ID.test(input.previewId) || !RESTORE_PREVIEW_TOKEN.test(input.archiveDigest)) {
    throw new PigeDomainError("restore.backup_invalid", "Restore identity is not valid.");
  }
  if (!JobIdSchema.safeParse(input.jobId).success) {
    throw new PigeDomainError("restore.backup_invalid", "Restore Job identity is not valid.");
  }
  if (!VaultIdSchema.safeParse(input.sourceVaultId).success || !VaultIdSchema.safeParse(input.resultVaultId).success) {
    throw new PigeDomainError("restore.backup_invalid", "Restore vault identity is not valid.");
  }
  if (input.mode === "replace_existing" && input.sourceVaultId !== input.resultVaultId) {
    throw new PigeDomainError("restore.identity_invalid", "Replace restore must preserve the source vault identity.");
  }
  if (input.mode === "clone_as_new" && input.sourceVaultId === input.resultVaultId) {
    throw new PigeDomainError("restore.identity_invalid", "Clone restore must mint a new vault identity.");
  }
}

function createRestoreApplyBinding(
  input: RestoreCoreApplyInput,
  destinationCoordinates: RestoreDestinationCoordinates
): RestoreApplyBinding {
  return {
    identityVersion: 2,
    jobId: input.jobId,
    previewId: input.previewId,
    archiveDigest: input.archiveDigest,
    mode: input.mode,
    sourceVaultId: input.sourceVaultId,
    resultVaultId: input.resultVaultId,
    destinationIdentity: destinationCoordinates.identityDigest
  };
}

function createRestoreCheckpointContext(
  binding: RestoreApplyBinding,
  backupIdentity: ResolvedBackupIdentity,
  externalDependencyCount: number
): RestoreCoreCheckpointContext {
  return {
    jobId: binding.jobId,
    previewId: binding.previewId,
    archiveDigest: binding.archiveDigest,
    backupId: backupIdentity.backupId,
    backupIdSource: backupIdentity.backupIdSource,
    mode: binding.mode,
    sourceVaultId: binding.sourceVaultId,
    resultVaultId: binding.resultVaultId,
    destinationIdentity: binding.destinationIdentity,
    externalDependencyCount
  };
}

async function reportRestoreCorePhase(
  reporter: RestoreCorePhaseReporter | undefined,
  context: RestoreCoreCheckpointContext,
  phase: RestoreCoreCheckpointPhase
): Promise<void> {
  await reporter?.({ phase, ...context });
}

async function reportBackupCreatePhase(
  reporter: BackupCreatePhaseReporter | undefined,
  context: Pick<BackupCreateCheckpointEvent, "backupId" | "createdAt" | "stagingOwnerKey">,
  phase: BackupCreateCheckpointPhase,
  details: Pick<BackupCreateCheckpointEvent, "manifestChecksum" | "archiveDigest"> = {}
): Promise<void> {
  await reporter?.({ phase, ...context, ...details });
}

function throwIfBackupAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Backup creation was cancelled.");
  error.name = "AbortError";
  throw error;
}

function isBackupAbortError(caught: unknown): boolean {
  return Boolean(caught && typeof caught === "object" && "name" in caught && caught.name === "AbortError");
}

function captureRestoreDestinationCoordinates(
  destinationPathInput: string,
  pathSafety: VaultPathSafetyOptions
): RestoreDestinationCoordinates {
  const destinationPath = path.resolve(destinationPathInput);
  assertVaultPathAllowed(destinationPath, pathSafety);
  const parentPath = path.dirname(destinationPath);
  if (parentPath === destinationPath) {
    throw new PigeDomainError("restore.destination_invalid", "Restore destination cannot be a filesystem root.");
  }
  const ancestors = captureRestoreAncestorChain(parentPath);
  assertNoAncestorVaultForRestore(ancestors);
  if (fs.existsSync(destinationPath)) {
    captureRestoreDirectoryIdentity(destinationPath);
  }
  const hash = createHash("sha256")
    .update("pige.restore.destination.v1\0", "utf8")
    .update(destinationPath, "utf8");
  for (const ancestor of ancestors) {
    hash
      .update("\0", "utf8")
      .update(ancestor.path, "utf8")
      .update("\0", "utf8")
      .update(String(ancestor.device), "utf8")
      .update(":", "utf8")
      .update(String(ancestor.inode), "utf8");
  }
  return {
    destinationPath,
    parentPath,
    identityDigest: `sha256:${hash.digest("hex")}`,
    ancestors
  };
}

function captureRestoreAncestorChain(directoryPathInput: string): readonly RestoreAncestorIdentity[] {
  const directoryPath = path.resolve(directoryPathInput);
  const root = path.parse(directoryPath).root;
  const paths: string[] = [];
  let current = directoryPath;
  while (true) {
    paths.unshift(current);
    if (current === root) break;
    current = path.dirname(current);
  }
  return paths.map((entryPath) => {
    let identity: fs.Stats;
    try {
      identity = fs.lstatSync(entryPath);
    } catch {
      throw new PigeDomainError("restore.destination_invalid", "Restore destination parent must already exist.");
    }
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw new PigeDomainError("restore.destination_invalid", "Restore destination ancestors cannot be symbolic links.");
    }
    return { path: entryPath, device: identity.dev, inode: identity.ino };
  });
}

function assertNoAncestorVaultForRestore(ancestors: readonly RestoreAncestorIdentity[]): void {
  for (const ancestor of ancestors) {
    const manifestPath = path.join(ancestor.path, RESTORE_COMMIT_ENTRY);
    try {
      fs.lstatSync(manifestPath);
      throw new PigeDomainError("restore.destination_invalid", "Restore destination cannot be nested inside a vault.");
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      if (!isErrno(caught, "ENOENT")) {
        throw new PigeDomainError("restore.destination_invalid", "Restore destination ancestry could not be verified.");
      }
    }
  }
}

function assertRestoreDestinationIdentity(
  expected: RestoreDestinationIdentity,
  current: RestoreDestinationCoordinates
): void {
  if (
    path.resolve(expected.destinationPath) !== current.destinationPath ||
    path.resolve(expected.parentPath) !== current.parentPath ||
    expected.identityDigest !== current.identityDigest
  ) {
    throw new PigeDomainError("restore.destination_invalid", "Restore destination identity changed before apply.");
  }
}

function assertCurrentRestoreDestinationCoordinates(
  expected: RestoreDestinationCoordinates,
  pathSafety: VaultPathSafetyOptions
): void {
  const current = captureRestoreDestinationCoordinates(expected.destinationPath, pathSafety);
  if (current.identityDigest !== expected.identityDigest || current.parentPath !== expected.parentPath) {
    throw new PigeDomainError("restore.destination_invalid", "Restore destination ancestry changed during apply.");
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

function createRestoreStagingDirectory(
  parentDirectory: string,
  destinationCoordinates: RestoreDestinationCoordinates,
  pathSafety: VaultPathSafetyOptions,
  binding: RestoreApplyBinding
): RestoreStagingHandle {
  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
  const stagingPath = fs.mkdtempSync(path.join(parentDirectory, ".pige-restore-"));
  fs.chmodSync(stagingPath, 0o700);
  const markerPath = path.join(stagingPath, RESTORE_STAGING_MARKER);
  const markerBody = `${JSON.stringify({
    identityVersion: 1,
    stagingId: randomUUID(),
    binding
  })}\n`;
  const markerIdentity = writeExclusiveRestoreFile(markerPath, markerBody);
  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
  return {
    path: stagingPath,
    identity: captureRestoreDirectoryIdentity(stagingPath),
    markerPath,
    markerIdentity,
    markerBody,
    destinationCoordinates,
    pathSafety
  };
}

function assertRestoreStagingIdentity(staging: RestoreStagingHandle): void {
  assertCurrentRestoreDestinationCoordinates(staging.destinationCoordinates, staging.pathSafety);
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

function ensureRestoreStagingDirectory(
  directoryPath: string,
  staging: RestoreStagingHandle
): void {
  ensureSafeRestoreSubdirectory(directoryPath, staging.path, () => assertRestoreStagingIdentity(staging));
}

function ensureSafeRestoreSubdirectory(
  directoryPath: string,
  rootPath: string,
  assertRootIdentity: () => void
): void {
  const relativePath = path.relative(rootPath, directoryPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new PigeDomainError("restore.result_invalid", "Restore directory escaped its owned root.");
  }
  let currentPath = rootPath;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    assertRootIdentity();
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

function materializeRestoreIdentity(
  staging: RestoreStagingHandle,
  sourceManifest: BackupManifest,
  backupId: string,
  mode: RestoreIdentityMode,
  resultVaultId: string
): BackupManifest {
  const sourceVaultManifest = readVaultManifest(staging.path);
  if (
    sourceVaultManifest.vault_id !== sourceManifest.vaultId ||
    sourceVaultManifest.vault_schema_version !== sourceManifest.vaultSchemaVersion
  ) {
    throw new PigeDomainError("restore.result_invalid", "Extracted vault identity does not match the backup manifest.");
  }
  const materialized = createMaterializedRestoreManifest(
    sourceManifest,
    sourceVaultManifest,
    backupId,
    mode,
    resultVaultId
  );
  if (mode === "replace_existing") return materialized;
  const restoredVaultManifest = VaultManifestSchema.parse({
    ...sourceVaultManifest,
    vault_id: resultVaultId,
    origin_vault_id: sourceManifest.vaultId,
    restored_from_backup_id: backupId
  });
  const manifestPath = resolveRestoreTarget(staging.path, RESTORE_COMMIT_ENTRY);
  writeOwnedStagingJson(manifestPath, restoredVaultManifest, staging);
  const actualManifestFile = snapshotRestoredFile(manifestPath);
  const expectedManifestFile = materialized.files.find((file) => file.path === RESTORE_COMMIT_ENTRY);
  if (
    !expectedManifestFile ||
    actualManifestFile.size !== expectedManifestFile.size ||
    actualManifestFile.checksum !== expectedManifestFile.checksum
  ) {
    throw new PigeDomainError("restore.result_invalid", "Restored clone identity failed exact readback.");
  }
  return materialized;
}

function createMaterializedRestoreManifest(
  sourceManifest: BackupManifest,
  sourceVaultManifest: VaultManifest,
  backupId: string,
  mode: RestoreIdentityMode,
  resultVaultId: string
): BackupManifest {
  let files = materializeExternalManagedCopyManifestFiles(sourceManifest);
  if (mode === "replace_existing") {
    return {
      ...sourceManifest,
      backupId,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      files
    };
  }
  const restoredVaultManifest = VaultManifestSchema.parse({
    ...sourceVaultManifest,
    vault_id: resultVaultId,
    origin_vault_id: sourceManifest.vaultId,
    restored_from_backup_id: backupId
  });
  const body = Buffer.from(`${JSON.stringify(restoredVaultManifest, null, 2)}\n`, "utf8");
  const restoredManifestFile = {
    path: RESTORE_COMMIT_ENTRY,
    size: body.byteLength,
    checksum: `sha256:${createHash("sha256").update(body).digest("hex")}`
  };
  files = files.map((file) => file.path === RESTORE_COMMIT_ENTRY
    ? restoredManifestFile
    : file);
  return {
    ...sourceManifest,
    backupId,
    vaultId: resultVaultId,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    files
  };
}

function materializeExternalManagedCopies(
  staging: RestoreStagingHandle,
  sourceManifest: BackupManifest
): void {
  const mappings = sourceManifest.externalManagedCopies ?? [];
  for (const mapping of mappings) {
    assertRestoreStagingIdentity(staging);
    const archivePath = resolveRestoreTarget(staging.path, mapping.archivePath);
    const restorePath = resolveRestoreTarget(staging.path, mapping.restorePath);
    ensureRestoreStagingDirectory(path.dirname(restorePath), staging);
    if (fs.existsSync(restorePath)) {
      throw new PigeDomainError("restore.result_invalid", "A managed-copy restore mapping collided with durable data.");
    }
    const archiveParentIdentity = captureRestoreDirectoryIdentity(path.dirname(archivePath));
    const restoreParentIdentity = captureRestoreDirectoryIdentity(path.dirname(restorePath));
    assertRestoreStagingIdentity(staging);
    assertRestoreDirectoryIdentity(path.dirname(archivePath), archiveParentIdentity);
    assertRestoreDirectoryIdentity(path.dirname(restorePath), restoreParentIdentity);
    fs.renameSync(archivePath, restorePath);
    assertRestoreDirectoryIdentity(path.dirname(archivePath), archiveParentIdentity);
    assertRestoreDirectoryIdentity(path.dirname(restorePath), restoreParentIdentity);
    fsyncDirectoryBestEffort(path.dirname(archivePath));
    fsyncDirectoryBestEffort(path.dirname(restorePath));
    const restoredCopy = snapshotRestoredFile(restorePath);
    if (restoredCopy.size !== mapping.size || restoredCopy.checksum !== mapping.checksum) {
      throw new PigeDomainError("restore.result_invalid", "A restored managed copy failed exact readback.");
    }

    const sourceRecordPath = resolveRestoreTarget(staging.path, mapping.sourceRecordPath);
    let record: SourceRecord;
    try {
      record = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as unknown);
    } catch {
      throw new PigeDomainError("restore.result_invalid", "A mapped SourceRecord could not be materialized.");
    }
    if (record.id !== mapping.sourceId || record.managedCopy?.rootId !== mapping.rootId) {
      throw new PigeDomainError("restore.result_invalid", "A mapped SourceRecord changed before materialization.");
    }
    writeOwnedStagingJson(
      sourceRecordPath,
      createRestoredExternalSourceRecord(record, mapping.restorePath),
      staging
    );
    const restoredRecord = snapshotRestoredFile(sourceRecordPath);
    if (
      restoredRecord.size !== mapping.restoredSourceRecordSize ||
      restoredRecord.checksum !== mapping.restoredSourceRecordChecksum
    ) {
      throw new PigeDomainError("restore.result_invalid", "A restored SourceRecord failed exact readback.");
    }
  }
  removeEmptyExternalManagedCopyArchiveDirectories(staging, mappings);
}

function materializeExternalManagedCopyManifestFiles(
  sourceManifest: BackupManifest
): BackupManifestFile[] {
  const mappings = sourceManifest.externalManagedCopies ?? [];
  const byArchivePath = new Map(mappings.map((mapping) => [mapping.archivePath, mapping]));
  const bySourceRecordPath = new Map(mappings.map((mapping) => [mapping.sourceRecordPath, mapping]));
  return sourceManifest.files.map((file) => {
    const payload = byArchivePath.get(file.path);
    if (payload) {
      return { path: payload.restorePath, size: payload.size, checksum: payload.checksum };
    }
    const sourceRecord = bySourceRecordPath.get(file.path);
    if (sourceRecord) {
      return {
        path: sourceRecord.sourceRecordPath,
        size: sourceRecord.restoredSourceRecordSize,
        checksum: sourceRecord.restoredSourceRecordChecksum
      };
    }
    return file;
  });
}

function removeEmptyExternalManagedCopyArchiveDirectories(
  staging: RestoreStagingHandle,
  mappings: readonly NonNullable<BackupManifest["externalManagedCopies"]>[number][]
): void {
  const rootPath = resolveRestoreTarget(staging.path, ".pige/backup-managed-copies");
  const candidates = new Set<string>();
  for (const mapping of mappings) {
    let current = path.dirname(resolveRestoreTarget(staging.path, mapping.archivePath));
    while (current !== path.dirname(rootPath) && isSameOrInside(current, rootPath)) {
      candidates.add(current);
      if (current === rootPath) break;
      current = path.dirname(current);
    }
  }
  for (const directoryPath of [...candidates].sort((left, right) => right.length - left.length)) {
    assertRestoreStagingIdentity(staging);
    const identity = fs.lstatSync(directoryPath);
    if (!identity.isDirectory() || identity.isSymbolicLink() || fs.readdirSync(directoryPath).length !== 0) {
      throw new PigeDomainError("restore.result_invalid", "Managed-copy archive staging was not empty after migration.");
    }
    fs.rmdirSync(directoryPath);
  }
  if (mappings.length > 0) fsyncDirectoryBestEffort(path.join(staging.path, ".pige"));
}

function writeOwnedStagingJson(
  filePath: string,
  value: unknown,
  staging: RestoreStagingHandle
): void {
  assertRestoreStagingIdentity(staging);
  const originalPathIdentity = fs.lstatSync(filePath);
  const flags = fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor);
    const pathBefore = fs.lstatSync(filePath);
    if (!sameFileRevision(originalPathIdentity, before) || !sameFileRevision(before, pathBefore)) {
      throw new PigeDomainError("restore.result_invalid", "Restore identity file changed before it was updated.");
    }
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (!sameInodeIdentity(before, after) || !sameFileRevision(after, pathAfter)) {
      throw new PigeDomainError("restore.result_invalid", "Restore identity file changed while it was updated.");
    }
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectoryBestEffort(path.dirname(filePath));
  assertRestoreStagingIdentity(staging);
}

function assertRestoreDirectoryShape(
  rootPath: string,
  manifest: BackupManifest,
  allowedControlFiles: readonly string[]
): void {
  const allowedFiles = new Set([...manifest.files.map((file) => file.path), ...allowedControlFiles]);
  const allowedDirectories = new Set<string>();
  for (const filePath of allowedFiles) {
    let current = path.posix.dirname(filePath);
    while (current !== ".") {
      allowedDirectories.add(current);
      current = path.posix.dirname(current);
    }
  }
  for (const directoryPath of [
    ...PIGE_DURABLE_ROOTS,
    ...PIGE_REBUILDABLE_ROOTS,
    ...PIGE_TRANSIENT_RUNTIME_ROOTS
  ]) {
    let current: string = directoryPath;
    while (current !== ".") {
      allowedDirectories.add(current);
      current = path.posix.dirname(current);
    }
  }

  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        throw new PigeDomainError("restore.result_invalid", "Restore output contains a symbolic link.");
      }
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(relativePath)) {
          throw new PigeDomainError("restore.result_invalid", "Restore output contains an undeclared directory.");
        }
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !allowedFiles.has(relativePath)) {
        throw new PigeDomainError("restore.result_invalid", "Restore output contains an undeclared file.");
      }
    }
  };
  visit(rootPath);
}

function validateExtractedRestore(
  directoryPath: string,
  manifest: BackupManifest,
  allowedControlFiles: readonly string[] = []
): void {
  assertRestoreDirectoryShape(directoryPath, manifest, allowedControlFiles);
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
  const restoredManifest = readVaultManifest(directoryPath);
  if (
    restoredManifest.vault_id !== manifest.vaultId ||
    restoredManifest.vault_schema_version !== manifest.vaultSchemaVersion
  ) {
    throw new PigeDomainError("restore.result_invalid", "Restored vault identity does not match its publication manifest.");
  }
}

function reserveRestorePublication(
  destinationCoordinates: RestoreDestinationCoordinates,
  pathSafety: VaultPathSafetyOptions,
  binding: RestoreApplyBinding
): RestorePublicationReservationHandle {
  const destinationPath = destinationCoordinates.destinationPath;
  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
  const sidecarPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.pige-restore.json`
  );
  let reservation: RestorePublicationReservation;
  let sidecarIdentity: fs.Stats;
  let createdSidecar = false;
  try {
    reservation = {
      ...binding,
      reservationId: randomUUID()
    };
    sidecarIdentity = writeExclusiveRestoreFile(sidecarPath, serializeRestoreReservation(reservation));
    createdSidecar = true;
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    const existing = readRestoreReservation(sidecarPath);
    if (!sameRestoreApplyBinding(existing.reservation, binding)) {
      throw new PigeDomainError("restore.destination_exists", "Restore destination is reserved by another restore.");
    }
    reservation = existing.reservation;
    sidecarIdentity = existing.identity;
  }

  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
  return {
    reservation,
    sidecarPath,
    sidecarIdentity,
    createdSidecar,
    destinationCoordinates,
    pathSafety
  };
}

function acquireRestorePublication(
  reserved: RestorePublicationReservationHandle,
  manifest: BackupManifest
): RestorePublicationHandle {
  const {
    reservation,
    sidecarPath,
    sidecarIdentity,
    createdSidecar,
    destinationCoordinates,
    pathSafety
  } = reserved;
  const destinationPath = destinationCoordinates.destinationPath;
  const reservationBody = serializeRestoreReservation(reservation);
  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
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
      alreadyCommitted: isPigeVault(destinationPath),
      createdSidecar,
      destinationCoordinates,
      pathSafety
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
      alreadyCommitted: true,
      createdSidecar,
      destinationCoordinates,
      pathSafety
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
    alreadyCommitted: false,
    createdSidecar,
    destinationCoordinates,
    pathSafety
  };
}

function captureCommittedRestorePublication(
  destinationCoordinates: RestoreDestinationCoordinates,
  pathSafety: VaultPathSafetyOptions,
  binding: RestoreApplyBinding
): RestorePublicationHandle | undefined {
  const destinationPath = destinationCoordinates.destinationPath;
  const sidecarPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.pige-restore.json`
  );
  const markerPath = path.join(destinationPath, ...RESTORE_PUBLICATION_MARKER.split("/"));
  const hasSidecar = fs.existsSync(sidecarPath);
  const hasMarker = fs.existsSync(markerPath);
  if (!hasSidecar && !hasMarker) return undefined;
  if (!hasSidecar) {
    throw new PigeDomainError("restore.destination_exists", "Committed restore ownership is incomplete.");
  }
  const sidecar = readRestoreReservation(sidecarPath);
  if (!sameRestoreApplyBinding(sidecar.reservation, binding)) {
    throw new PigeDomainError("restore.destination_exists", "Committed restore ownership changed.");
  }
  const marker = hasMarker ? readRestoreReservation(markerPath) : undefined;
  if (marker && serializeRestoreReservation(marker.reservation) !== serializeRestoreReservation(sidecar.reservation)) {
    throw new PigeDomainError("restore.destination_exists", "Committed restore marker changed.");
  }
  assertCurrentRestoreDestinationCoordinates(destinationCoordinates, pathSafety);
  return {
    reservation: sidecar.reservation,
    sidecarPath,
    sidecarIdentity: sidecar.identity,
    createdSidecar: false,
    destinationCoordinates,
    pathSafety,
    destinationPath,
    destinationIdentity: captureRestoreDirectoryIdentity(destinationPath),
    ...(marker ? { markerPath, markerIdentity: marker.identity } : {}),
    alreadyCommitted: true
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
    for (const durableRoot of PIGE_DURABLE_ROOTS) {
      ensureRestorePublicationDirectory(
        path.join(publication.destinationPath, durableRoot),
        publication
      );
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
  validateExtractedRestore(
    publication.destinationPath,
    manifest,
    publication.markerPath ? [RESTORE_PUBLICATION_MARKER] : []
  );
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
  ensureSafeRestoreSubdirectory(
    directoryPath,
    publication.destinationPath,
    () => assertRestorePublicationIdentity(publication)
  );
}

function assertRestorePublicationIdentity(publication: RestorePublicationHandle): void {
  assertCurrentRestoreDestinationCoordinates(publication.destinationCoordinates, publication.pathSafety);
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
    const markerRemoved = removeOwnedRestoreFile(
      publication.markerPath,
      publication.markerIdentity,
      reservationBody
    );
    if (!markerRemoved) return;
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
    value.identityVersion !== 2 ||
    typeof value.jobId !== "string" ||
    !JobIdSchema.safeParse(value.jobId).success ||
    typeof value.previewId !== "string" ||
    !RESTORE_PREVIEW_ID.test(value.previewId) ||
    typeof value.archiveDigest !== "string" ||
    !RESTORE_PREVIEW_TOKEN.test(value.archiveDigest) ||
    (value.mode !== "clone_as_new" && value.mode !== "replace_existing") ||
    typeof value.sourceVaultId !== "string" ||
    !VaultIdSchema.safeParse(value.sourceVaultId).success ||
    typeof value.resultVaultId !== "string" ||
    !VaultIdSchema.safeParse(value.resultVaultId).success ||
    typeof value.destinationIdentity !== "string" ||
    !RESTORE_PREVIEW_TOKEN.test(value.destinationIdentity) ||
    typeof value.reservationId !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(value.reservationId)
  ) {
    throw new PigeDomainError("restore.destination_exists", "Restore reservation is not valid.");
  }
  return {
    reservation: {
      identityVersion: 2,
      jobId: value.jobId,
      previewId: value.previewId,
      archiveDigest: value.archiveDigest,
      mode: value.mode,
      sourceVaultId: value.sourceVaultId,
      resultVaultId: value.resultVaultId,
      destinationIdentity: value.destinationIdentity,
      reservationId: value.reservationId
    },
    identity: snapshot.identity
  };
}

function sameRestoreApplyBinding(
  left: RestoreApplyBinding,
  right: RestoreApplyBinding
): boolean {
  return left.identityVersion === right.identityVersion &&
    left.jobId === right.jobId &&
    left.previewId === right.previewId &&
    left.archiveDigest === right.archiveDigest &&
    left.mode === right.mode &&
    left.sourceVaultId === right.sourceVaultId &&
    left.resultVaultId === right.resultVaultId &&
    left.destinationIdentity === right.destinationIdentity;
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

function removeOwnedRestoreFile(filePath: string, expected: fs.Stats, body: string): boolean {
  try {
    assertOwnedRestoreFile(filePath, expected, body);
    fs.unlinkSync(filePath);
    return true;
  } catch {
    // A stale ownership marker is safer than unlinking a path whose identity changed.
    return false;
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

function snapshotBackupSourceFile(
  filePath: string,
  signal?: AbortSignal
): { readonly size: number; readonly checksum: string; readonly identity: fs.Stats } {
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
      throwIfBackupAborted(signal);
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
    return { size: after.size, checksum: `sha256:${hash.digest("hex")}`, identity: after };
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

function createPreviewWarnings(
  manifest: BackupManifest,
  invalidFiles: readonly string[]
): readonly RestorePreviewWarning[] {
  const omittedExternalDependencyCount = countUnresolvedExternalDependencies(manifest);
  return [
    ...(invalidFiles.length > 0 ? [{
      code: "invalid_archive_entries" as const,
      count: invalidFiles.length
    }] : []),
    ...(manifest.excludedRoots.length > 0 ? [{
      code: "excluded_rebuildable_roots" as const,
      count: manifest.excludedRoots.length
    }] : []),
    ...(omittedExternalDependencyCount > 0
      ? [{
          code: "external_originals_not_included" as const,
          count: omittedExternalDependencyCount
        }]
      : [])
  ];
}

function countUnresolvedExternalDependencies(manifest: BackupManifest): number {
  return manifest.externalDependencies.filter((dependency) =>
    typeof dependency === "string" || !dependency.included || dependency.requiredForCompleteRestore
  ).length;
}

export function canonicalizeBackupDestinationPath(filePathInput: string): string {
  const resolved = path.resolve(filePathInput);
  const normalized = resolved.endsWith(".pige-backup.zip")
    ? resolved
    : resolved.endsWith(".zip")
      ? `${resolved.slice(0, -4)}.pige-backup.zip`
      : `${resolved}.pige-backup.zip`;
  const canonicalParent = resolveCanonicalBackupDirectory(path.dirname(normalized));
  return path.join(canonicalParent, path.basename(normalized));
}

export function captureBackupDestinationFence(filePathInput: string): BackupDestinationFence {
  const destinationPath = canonicalizeBackupDestinationPath(filePathInput);
  let ancestorPath = path.dirname(destinationPath);
  while (!fs.existsSync(ancestorPath)) {
    const parent = path.dirname(ancestorPath);
    if (parent === ancestorPath) {
      throw new PigeDomainError("backup.destination_changed", "Backup destination ancestor is unavailable.");
    }
    ancestorPath = parent;
  }
  try {
    const ancestor = fs.lstatSync(ancestorPath);
    if (
      !ancestor.isDirectory() ||
      ancestor.isSymbolicLink() ||
      fs.realpathSync.native(ancestorPath) !== ancestorPath
    ) {
      throw new Error("Backup destination ancestor is unsafe.");
    }
    return {
      destinationPath,
      ancestorPath,
      ancestorDevice: ancestor.dev,
      ancestorInode: ancestor.ino
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("backup.destination_changed", "Backup destination ancestor is unavailable or unsafe.");
  }
}

export function prepareBackupDestinationPath(filePathInput: string): string {
  const canonical = canonicalizeBackupDestinationPath(filePathInput);
  const canonicalParent = ensureCanonicalBackupDirectory(path.dirname(canonical));
  return path.join(canonicalParent, path.basename(canonical));
}

function assertExpectedBackupDestinationFence(
  current: BackupDestinationFence,
  expected: BackupDestinationFence | undefined
): void {
  if (!expected) return;
  if (
    current.destinationPath !== expected.destinationPath ||
    current.ancestorPath !== expected.ancestorPath ||
    current.ancestorDevice !== expected.ancestorDevice ||
    current.ancestorInode !== expected.ancestorInode
  ) {
    throw new PigeDomainError("backup.destination_changed", "Backup destination binding changed before execution.");
  }
}

function assertBackupDestinationFence(expected: BackupDestinationFence): void {
  try {
    const current = fs.lstatSync(expected.ancestorPath);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      fs.realpathSync.native(expected.ancestorPath) !== expected.ancestorPath ||
      current.dev !== expected.ancestorDevice ||
      current.ino !== expected.ancestorInode
    ) {
      throw new Error("Backup destination ancestor changed.");
    }
  } catch {
    throw new PigeDomainError("backup.destination_changed", "Backup destination ancestor changed during backup.");
  }
}

function resolveCanonicalBackupDirectory(directoryPathInput: string): string {
  let existing = path.resolve(directoryPathInput);
  const missingSegments: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new PigeDomainError("backup.destination_not_writable", "Backup destination parent is unavailable.");
    }
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    const existingStat = fs.statSync(existing);
    if (!existingStat.isDirectory()) throw new Error("Backup destination ancestor is not a directory.");
    return path.join(fs.realpathSync.native(existing), ...missingSegments);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "backup.destination_not_writable",
      "Backup destination parent cannot be resolved safely."
    );
  }
}

function ensureCanonicalBackupDirectory(directoryPathInput: string): string {
  let existing = path.resolve(directoryPathInput);
  const missingSegments: string[] = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new PigeDomainError("backup.destination_not_writable", "Backup destination parent is unavailable.");
    }
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  let canonical: string;
  try {
    const existingStat = fs.statSync(existing);
    if (!existingStat.isDirectory()) throw new Error("Backup destination ancestor is not a directory.");
    canonical = fs.realpathSync.native(existing);
    for (const segment of missingSegments) {
      const next = path.join(canonical, segment);
      try {
        fs.mkdirSync(next, { mode: 0o700 });
      } catch (caught) {
        if (!isErrno(caught, "EEXIST")) throw caught;
      }
      const nextStat = fs.lstatSync(next);
      if (!nextStat.isDirectory() || nextStat.isSymbolicLink() || fs.realpathSync.native(next) !== next) {
        throw new Error("Backup destination directory changed during creation.");
      }
      canonical = next;
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "backup.destination_not_writable",
      "Backup destination parent cannot be prepared safely."
    );
  }
  return canonical;
}

function captureBackupDestinationParent(backupFilePath: string): fs.Stats {
  const parent = path.dirname(backupFilePath);
  try {
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(parent) !== parent) {
      throw new Error("Backup destination parent is unsafe.");
    }
    return stat;
  } catch {
    throw new PigeDomainError(
      "backup.destination_changed",
      "Backup destination parent is unavailable or unsafe."
    );
  }
}

function assertBackupDestinationParent(backupFilePath: string, expected: fs.Stats): void {
  const current = captureBackupDestinationParent(backupFilePath);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new PigeDomainError("backup.destination_changed", "Backup destination parent changed during backup.");
  }
}

function createBackupStagingPath(backupFilePath: string, stagingOwnerKey: string): string {
  const ownerDigest = createHash("sha256")
    .update("pige:backup-staging-owner:v1\0", "utf8")
    .update(stagingOwnerKey, "utf8")
    .digest("hex")
    .slice(0, 32);
  return path.join(
    path.dirname(backupFilePath),
    `.${path.basename(backupFilePath)}.${ownerDigest}.tmp`
  );
}

function removeExactAdoptedStagingLink(stagingPath: string, destinationPath: string): void {
  try {
    const staging = fs.lstatSync(stagingPath);
    const destination = fs.lstatSync(destinationPath);
    if (
      !staging.isSymbolicLink() &&
      staging.nlink === destination.nlink &&
      sameFileDataRevision(staging, destination)
    ) {
      fs.rmSync(stagingPath);
      fsyncDirectoryBestEffort(path.dirname(destinationPath));
    }
  } catch {
    // A final archive is authoritative; uncertain staging is preserved for explicit repair.
  }
}

function assertAdoptableFinalLinkOwnership(
  stagingPath: string,
  destinationPath: string,
  destinationIdentity: fs.Stats
): void {
  if (destinationIdentity.nlink === 1) return;
  try {
    const staging = fs.lstatSync(stagingPath);
    if (
      staging.nlink === destinationIdentity.nlink &&
      sameFileDataRevision(staging, destinationIdentity)
    ) return;
  } catch {
    // The conflict below is the safe result for an unexplained destination link.
  }
  throw new PigeDomainError(
    "backup.destination_exists",
    "Backup destination publication ownership cannot be proven."
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
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("\\") ||
    /^[A-Za-z]:/u.test(relativePath) ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized === ".." ||
    normalized !== relativePath ||
    relativePath === RESTORE_PUBLICATION_MARKER ||
    relativePath === RESTORE_STAGING_MARKER
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
