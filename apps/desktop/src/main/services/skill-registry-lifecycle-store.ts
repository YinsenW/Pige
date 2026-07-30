import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ExternalWebSkillRuntimeIdentitySchema,
  SkillIdSchema,
  SkillInstallSourceKindSchema,
  SkillInstallUrlSchema,
  SkillInstallRequestIdSchema,
  SkillLifecycleRequestIdSchema,
  SkillRegistryRecordSchema,
  SkillStagingIdSchema,
  SkillStageWarningSchema,
  VaultIdSchema,
  type ExternalWebSkillRuntimeIdentity,
  type SkillManifest,
  type SkillRegistryFile,
  type SkillInstallSourceKind,
  type SkillRegistryRecord,
  type SkillStageWarning
} from "@pige/schemas";
import {
  normalizeBundleFiles,
  skillBundleSha256,
  type SkillBundleFile
} from "./skill-zip-stage-service";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_INSTALL_RECEIPT_BYTES = 4 * 1024;
const MAX_UNINSTALL_RECEIPT_BYTES = 16 * 1024;
const MAX_UPDATE_RECEIPT_BYTES = 16 * 1024;
const INSTALL_RECEIPT_NAME = ".pige-install.json";
const UNINSTALL_RECEIPT_NAME = ".pige-uninstall.json";
const UPDATE_RECEIPT_NAME = ".pige-update.json";
const TRASHED_SKILL_NAME = "skill";

export interface SkillInstallReceipt {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly stagingId: string;
  readonly manifestSha256: string;
  readonly bundleSha256: string;
  readonly enabled: boolean;
  readonly source?: SkillInstallSourceKind;
  readonly sourceUrl?: string;
  readonly warnings?: readonly SkillStageWarning[];
}

export interface InstalledSkillSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly bundleSha256: string;
  readonly files: readonly SkillBundleFile[];
}

export interface EnabledExternalWebSkillRuntime {
  readonly identity: ExternalWebSkillRuntimeIdentity;
  readonly name: string;
  readonly triggers: readonly string[];
}

export function projectEnabledExternalWebSkillRuntimes(
  registry: SkillRegistryFile,
  readManifest: (skillId: string) => {
    readonly manifest: SkillManifest;
    readonly sha256: string;
    readonly bundleSha256: string;
  }
): readonly EnabledExternalWebSkillRuntime[] {
  const runtimes: EnabledExternalWebSkillRuntime[] = [];
  for (const record of registry.skills) {
    if (!record.enabled || record.trust !== "user_confirmed") continue;
    try {
      const loaded = readManifest(record.id);
      const manifest = loaded.manifest;
      if (!isSupportedExternalWebRuntime(manifest) || loaded.sha256 !== record.manifestSha256 ||
        manifest.id !== record.id || manifest.version !== record.version) continue;
      const identityBase = {
        skillId: manifest.id,
        skillVersion: manifest.version,
        manifestSha256: loaded.sha256,
        bundleSha256: loaded.bundleSha256,
        registryRevision: registry.revision,
        runtime: manifest.runtime
      };
      runtimes.push({
        identity: ExternalWebSkillRuntimeIdentitySchema.parse({
          kind: "external_web",
          scope: "machine_local",
          trust: "user_confirmed",
          enabled: true,
          ...identityBase,
          runtimeIdentityHash: digestRuntimeIdentity(identityBase)
        }),
        name: manifest.name,
        triggers: Object.freeze([...(manifest.triggers ?? [])])
      });
    } catch {
      // Invalid or drifting installed bytes contribute no runtime authority.
    }
  }
  return Object.freeze(runtimes.sort((left, right) => left.identity.skillId.localeCompare(right.identity.skillId, "en")));
}

export function isSupportedExternalWebRuntime(manifest: SkillManifest): manifest is SkillManifest & {
  readonly kind: "external_web";
  readonly runtime: NonNullable<SkillManifest["runtime"]>;
} {
  const permissionCapabilities = manifest.capabilities.filter(isPermissionCapability);
  return manifest.kind === "external_web" && manifest.scope === "machine_local" &&
    manifest.runtime?.adapter === "pige_readonly_https_v1" &&
    permissionCapabilities.length === 1 && permissionCapabilities[0] === "external_network";
}

export function readSkillEnableEligibility(
  record: SkillRegistryRecord,
  readManifest: (skillId: string) => { readonly manifest: SkillManifest; readonly sha256: string }
): boolean {
  try {
    const loaded = readManifest(record.id);
    return record.trust === "user_confirmed" && loaded.sha256 === record.manifestSha256 &&
      loaded.manifest.id === record.id && loaded.manifest.version === record.version &&
      loaded.manifest.scope === "machine_local" &&
      (loaded.manifest.kind === "pure" || isSupportedExternalWebRuntime(loaded.manifest));
  } catch { return false; }
}

export function projectInstalledExternalDisclosure(loaded: {
  readonly sha256: string;
  readonly bundleSha256: string;
  readonly files: readonly SkillBundleFile[];
  readonly receipt: SkillInstallReceipt | undefined;
}) {
  const receipt = loaded.receipt;
  if (!receipt?.source || !receipt.warnings || receipt.enabled ||
    (receipt.source === "https") !== Boolean(receipt.sourceUrl)) return undefined;
  return {
    source: receipt.source,
    ...(receipt.sourceUrl ? { sourceUrl: receipt.sourceUrl } : {}),
    manifestSha256: loaded.sha256,
    bundleSha256: loaded.bundleSha256,
    files: loaded.files.map((file) => ({
      relativePath: file.relativePath,
      utf8ByteSize: file.bytes.length,
      sha256: file.sha256
    })),
    warnings: [...receipt.warnings]
  };
}

export function requireInstalledExternalDisclosure(loaded: Parameters<typeof projectInstalledExternalDisclosure>[0]) {
  const disclosure = projectInstalledExternalDisclosure(loaded);
  if (!disclosure) throw lifecycleError("skill.install_receipt_invalid");
  return disclosure;
}

export interface SkillUninstallReceiptV1 {
  readonly schemaVersion: 1; readonly state: "prepared" | "committed";
  readonly requestId: string; readonly activeVaultId: string; readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly committedRegistryRevision?: number;
  readonly record: SkillRegistryRecord; readonly manifestSha256: string; readonly createdAt: string;
}

export interface SkillUninstallReceiptV2 extends Omit<SkillUninstallReceiptV1, "schemaVersion"> {
  readonly schemaVersion: 2; readonly bundleSha256: string; readonly installReceiptSha256: string;
}

export type SkillUninstallReceipt = SkillUninstallReceiptV1 | SkillUninstallReceiptV2;

export interface SkillUpdateReceiptV1 {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly stagingId: string;
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly committedRegistryRevision?: number;
  readonly oldRecord: SkillRegistryRecord;
  readonly newManifestSha256: string;
  readonly newVersion: string;
  readonly enabled: boolean;
  readonly createdAt: string;
}

export interface SkillUpdateReceiptV2 extends Omit<SkillUpdateReceiptV1, "schemaVersion"> {
  readonly schemaVersion: 2;
  readonly oldBundleSha256: string;
  readonly oldInstallReceiptSha256: string;
  readonly newBundleSha256: string;
  readonly newInstallReceiptSha256: string;
}

export type SkillUpdateReceipt = SkillUpdateReceiptV1 | SkillUpdateReceiptV2;

export class SkillRegistryLifecycleStore {
  readonly #appDataRoot: string;
  readonly #rootPath: string;
  readonly #installedRoot: string;
  readonly #trashRoot: string;
  readonly #updateRoot: string;

  constructor(appDataRoot: string) {
    if (!path.isAbsolute(appDataRoot)) throw lifecycleError("skill.registry_root_invalid");
    this.#appDataRoot = path.resolve(appDataRoot);
    this.#rootPath = path.join(this.#appDataRoot, "skills");
    this.#installedRoot = path.join(this.#rootPath, "installed");
    this.#trashRoot = path.join(this.#rootPath, "trash");
    this.#updateRoot = path.join(this.#trashRoot, "updates");
    this.prepare();
  }

  prepare(): void {
    assertOwnedDirectory(this.#appDataRoot);
    createOwnedDirectory(this.#rootPath);
    createOwnedDirectory(this.#installedRoot);
    createOwnedDirectory(this.#trashRoot);
    createOwnedDirectory(this.#updateRoot);
  }

  readInstalled(skillIdInput: string): InstalledSkillSnapshot {
    const skillId = SkillIdSchema.parse(skillIdInput);
    return readManifestDirectory(this.#installedRoot, path.join(this.#installedRoot, skillId));
  }

  publishInstalled(skillIdInput: string, files: readonly SkillBundleFile[], receipt: SkillInstallReceipt): void {
    this.prepare();
    const skillId = SkillIdSchema.parse(skillIdInput);
    if (skillBundleSha256(files) !== receipt.bundleSha256) throw lifecycleError("skill.install_payload_changed");
    const destination = path.join(this.#installedRoot, skillId);
    if (fs.existsSync(destination)) {
      const existing = this.readInstallReceipt(skillId);
      const snapshot = this.readInstalled(skillId);
      if (!existing || stableJson(existing) !== stableJson(receipt) || snapshot.sha256 !== receipt.manifestSha256 ||
        snapshot.bundleSha256 !== receipt.bundleSha256) {
        throw lifecycleError("skill.install_collision");
      }
      return;
    }
    const temporaryPath = path.join(this.#installedRoot, `.install.${skillId}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      writeBundleFiles(temporaryPath, files);
      writePrivateFile(path.join(temporaryPath, INSTALL_RECEIPT_NAME), Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8"));
      fsyncTree(temporaryPath);
      fs.renameSync(temporaryPath, destination);
      renamed = true;
      fsyncDirectory(this.#installedRoot);
    } finally {
      if (!renamed) fs.rmSync(temporaryPath, { recursive: true, force: true });
    }
  }

  readInstallReceipt(skillIdInput: string): SkillInstallReceipt | undefined {
    const skillId = SkillIdSchema.parse(skillIdInput);
    const directory = path.join(this.#installedRoot, skillId);
    if (!fs.existsSync(directory)) return undefined;
    assertChildDirectory(this.#installedRoot, directory);
    const source = readBoundedNoFollow(path.join(directory, INSTALL_RECEIPT_NAME), MAX_INSTALL_RECEIPT_BYTES);
    return source === undefined ? undefined : parseInstallReceipt(source);
  }

  prepareUninstall(input: {
    readonly requestId: string; readonly activeVaultId: string; readonly expectedRegistryRevision: number;
    readonly record: SkillRegistryRecord; readonly createdAt: string;
  }): SkillUninstallReceipt {
    this.prepare();
    const requestId = SkillLifecycleRequestIdSchema.parse(input.requestId);
    const record = SkillRegistryRecordSchema.parse(input.record);
    const existing = this.readUninstallReceipt(requestId);
    const snapshot = existing ? undefined : this.readInstalled(record.id);
    const installReceipt = existing ? undefined : this.readInstallReceipt(record.id);
    const manifestSha256 = existing?.manifestSha256 ?? snapshot!.sha256;
    if (manifestSha256 !== record.manifestSha256) throw lifecycleError("skill.manifest_changed");
    const base = {
      state: "prepared", requestId, activeVaultId: input.activeVaultId, skillId: record.id,
      expectedRegistryRevision: input.expectedRegistryRevision,
      record, manifestSha256, createdAt: input.createdAt
    } as const;
    const expected: SkillUninstallReceipt = installReceipt &&
      installReceipt.manifestSha256 === snapshot!.sha256 && installReceipt.bundleSha256 === snapshot!.bundleSha256
      ? {
          ...base, schemaVersion: 2, bundleSha256: snapshot!.bundleSha256,
          installReceiptSha256: digestStableJson(installReceipt)
        }
      : { ...base, schemaVersion: 1 };
    const receipt = existing ?? this.#publishUninstallReceipt(expected);
    if (!sameUninstallIntent(receipt, expected)) throw lifecycleError("skill.uninstall_receipt_conflict");
    this.ensureTrashed(receipt);
    return receipt;
  }

  readUninstallReceipt(requestIdInput: string): SkillUninstallReceipt | undefined {
    const requestId = SkillLifecycleRequestIdSchema.parse(requestIdInput);
    const receiptDirectory = this.#trashEntry(requestId);
    if (!fs.existsSync(receiptDirectory)) return undefined;
    assertChildDirectory(this.#trashRoot, receiptDirectory);
    const source = readBoundedNoFollow(path.join(receiptDirectory, UNINSTALL_RECEIPT_NAME), MAX_UNINSTALL_RECEIPT_BYTES);
    if (source === undefined) throw lifecycleError("skill.uninstall_receipt_invalid");
    const receipt = parseUninstallReceipt(source);
    if (receipt.requestId !== requestId) throw lifecycleError("skill.uninstall_receipt_invalid");
    return receipt;
  }

  listPreparedUninstalls(): readonly SkillUninstallReceipt[] {
    return this.listUninstallReceipts().filter((receipt) => receipt.state === "prepared");
  }

  listUninstallReceipts(): readonly SkillUninstallReceipt[] {
    this.prepare();
    const receipts: SkillUninstallReceipt[] = [];
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SkillLifecycleRequestIdSchema.safeParse(entry.name).success) continue;
      const receipt = this.readUninstallReceipt(entry.name);
      if (receipt) receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  ensureTrashed(receipt: SkillUninstallReceipt): void {
    const receiptDirectory = this.#trashEntry(receipt.requestId);
    assertChildDirectory(this.#trashRoot, receiptDirectory);
    const trashedPath = path.join(receiptDirectory, TRASHED_SKILL_NAME);
    const installedPath = path.join(this.#installedRoot, receipt.skillId);
    const trashedExists = fs.existsSync(trashedPath);
    const installedExists = fs.existsSync(installedPath);
    if (trashedExists && installedExists) throw lifecycleError("skill.uninstall_path_conflict");
    if (trashedExists) {
      if (readManifestDirectory(receiptDirectory, trashedPath).sha256 !== receipt.manifestSha256) {
        throw lifecycleError("skill.uninstall_payload_changed");
      }
      return;
    }
    if (!installedExists || this.readInstalled(receipt.skillId).sha256 !== receipt.manifestSha256) {
      throw lifecycleError("skill.uninstall_payload_missing");
    }
    fs.renameSync(installedPath, trashedPath);
    fsyncDirectory(this.#installedRoot);
    fsyncDirectory(receiptDirectory);
    if (readManifestDirectory(receiptDirectory, trashedPath).sha256 !== receipt.manifestSha256) {
      throw lifecycleError("skill.uninstall_payload_changed");
    }
  }

  markUninstallCommitted(receipt: SkillUninstallReceipt, registryRevision: number): SkillUninstallReceipt {
    this.ensureTrashed(receipt);
    const current = this.readUninstallReceipt(receipt.requestId);
    if (!current || !sameUninstallIntent(current, receipt)) throw lifecycleError("skill.uninstall_receipt_conflict");
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== registryRevision) throw lifecycleError("skill.uninstall_receipt_conflict");
      return current;
    }
    const committed: SkillUninstallReceipt = { ...current, state: "committed", committedRegistryRevision: registryRevision };
    writeJsonAtomic(path.join(this.#trashEntry(receipt.requestId), UNINSTALL_RECEIPT_NAME), committed);
    return committed;
  }

  prepareUpdate(input: {
    readonly requestId: string;
    readonly stagingId: string;
    readonly activeVaultId: string;
    readonly expectedRegistryRevision: number;
    readonly oldRecord: SkillRegistryRecord;
    readonly newManifestSha256: string;
    readonly newVersion: string;
    readonly enabled: boolean;
    readonly bytes: Buffer;
    readonly files?: readonly SkillBundleFile[];
    readonly installReceipt?: SkillInstallReceipt;
    readonly createdAt: string;
  }): SkillUpdateReceipt {
    this.prepare();
    const requestId = SkillInstallRequestIdSchema.parse(input.requestId);
    const oldRecord = SkillRegistryRecordSchema.parse(input.oldRecord);
    if (`sha256:${createHash("sha256").update(input.bytes).digest("hex")}` !== input.newManifestSha256) {
      throw lifecycleError("skill.update_payload_changed");
    }
    const base = {
      schemaVersion: 1,
      state: "prepared",
      requestId,
      stagingId: input.stagingId,
      activeVaultId: VaultIdSchema.parse(input.activeVaultId),
      skillId: oldRecord.id,
      expectedRegistryRevision: input.expectedRegistryRevision,
      oldRecord,
      newManifestSha256: input.newManifestSha256,
      newVersion: input.newVersion,
      enabled: input.enabled,
      createdAt: input.createdAt
    } as const;
    const externalUpdate = input.files !== undefined || input.installReceipt !== undefined;
    let expected: SkillUpdateReceipt = base;
    if (externalUpdate) {
      if (!input.files || !input.installReceipt || skillBundleSha256(input.files) !== input.installReceipt.bundleSha256 ||
        input.installReceipt.manifestSha256 !== input.newManifestSha256 || input.installReceipt.enabled ||
        input.installReceipt.requestId !== requestId || input.installReceipt.stagingId !== input.stagingId) {
        throw lifecycleError("skill.update_payload_changed");
      }
      const oldSnapshot = this.readInstalled(oldRecord.id);
      const oldInstallReceipt = this.readInstallReceipt(oldRecord.id);
      if (!oldInstallReceipt || oldSnapshot.sha256 !== oldRecord.manifestSha256) {
        throw lifecycleError("skill.update_payload_changed");
      }
      expected = {
        ...base,
        schemaVersion: 2,
        oldBundleSha256: oldSnapshot.bundleSha256,
        oldInstallReceiptSha256: digestStableJson(oldInstallReceipt),
        newBundleSha256: input.installReceipt.bundleSha256,
        newInstallReceiptSha256: digestStableJson(input.installReceipt)
      };
    }
    const existing = this.readUpdateReceipt(requestId);
    const receipt = existing ?? this.#publishUpdateReceipt(expected, input.bytes, input.files, input.installReceipt);
    if (!sameUpdateIntent(receipt, expected)) throw lifecycleError("skill.update_receipt_conflict");
    this.ensureUpdated(receipt);
    return receipt;
  }

  readUpdateReceipt(requestIdInput: string): SkillUpdateReceipt | undefined {
    const requestId = SkillInstallRequestIdSchema.parse(requestIdInput);
    const directory = this.#updateEntry(requestId);
    if (!fs.existsSync(directory)) return undefined;
    assertChildDirectory(this.#updateRoot, directory);
    const source = readBoundedNoFollow(path.join(directory, UPDATE_RECEIPT_NAME), MAX_UPDATE_RECEIPT_BYTES);
    if (source === undefined) throw lifecycleError("skill.update_receipt_invalid");
    const receipt = parseUpdateReceipt(source);
    if (receipt.requestId !== requestId) throw lifecycleError("skill.update_receipt_invalid");
    return receipt;
  }

  listPreparedUpdates(): readonly SkillUpdateReceipt[] {
    this.prepare();
    const receipts: SkillUpdateReceipt[] = [];
    for (const entry of fs.readdirSync(this.#updateRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SkillInstallRequestIdSchema.safeParse(entry.name).success) continue;
      const receipt = this.readUpdateReceipt(entry.name);
      if (receipt?.state === "prepared") receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  ensureUpdated(receipt: SkillUpdateReceipt): void {
    const receiptDirectory = this.#updateEntry(receipt.requestId);
    assertChildDirectory(this.#updateRoot, receiptDirectory);
    const oldPath = path.join(receiptDirectory, TRASHED_SKILL_NAME);
    const replacementPath = path.join(receiptDirectory, "replacement");
    const installedPath = path.join(this.#installedRoot, receipt.skillId);
    const installed = fs.existsSync(installedPath) ? this.readInstalled(receipt.skillId) : undefined;
    if (installed?.sha256 === receipt.oldRecord.manifestSha256) {
      if (receipt.schemaVersion === 2) this.#assertUpdateTree(receipt, installedPath, "old");
      if (fs.existsSync(oldPath)) throw lifecycleError("skill.update_path_conflict");
      fs.renameSync(installedPath, oldPath);
      fsyncDirectory(this.#installedRoot);
      fsyncDirectory(receiptDirectory);
    } else if (installed && installed.sha256 !== receipt.newManifestSha256) {
      throw lifecycleError("skill.update_path_conflict");
    }
    if (!fs.existsSync(oldPath) || readManifestDirectory(receiptDirectory, oldPath).sha256 !== receipt.oldRecord.manifestSha256) {
      throw lifecycleError("skill.update_payload_missing");
    }
    if (receipt.schemaVersion === 2) this.#assertUpdateTree(receipt, oldPath, "old");
    if (!fs.existsSync(installedPath)) {
      if (!fs.existsSync(replacementPath) || readManifestDirectory(receiptDirectory, replacementPath).sha256 !== receipt.newManifestSha256) {
        throw lifecycleError("skill.update_payload_missing");
      }
      if (receipt.schemaVersion === 2) this.#assertUpdateTree(receipt, replacementPath, "new");
      fs.renameSync(replacementPath, installedPath);
      fsyncDirectory(receiptDirectory);
      fsyncDirectory(this.#installedRoot);
    }
    if (this.readInstalled(receipt.skillId).sha256 !== receipt.newManifestSha256) {
      throw lifecycleError("skill.update_payload_changed");
    }
    if (receipt.schemaVersion === 2) this.#assertUpdateTree(receipt, installedPath, "new");
  }

  #assertUpdateTree(receipt: SkillUpdateReceiptV2, directory: string, side: "old" | "new"): void {
    const parent = path.dirname(directory);
    const snapshot = readManifestDirectory(parent, directory);
    const installReceipt = parseInstallReceipt(
      readBoundedNoFollow(path.join(directory, INSTALL_RECEIPT_NAME), MAX_INSTALL_RECEIPT_BYTES) ?? ""
    );
    const expectedBundle = side === "old" ? receipt.oldBundleSha256 : receipt.newBundleSha256;
    const expectedInstallReceipt = side === "old" ? receipt.oldInstallReceiptSha256 : receipt.newInstallReceiptSha256;
    if (snapshot.bundleSha256 !== expectedBundle || digestStableJson(installReceipt) !== expectedInstallReceipt) {
      throw lifecycleError("skill.update_payload_changed");
    }
  }

  markUpdateCommitted(receipt: SkillUpdateReceipt, registryRevision: number): SkillUpdateReceipt {
    this.ensureUpdated(receipt);
    const current = this.readUpdateReceipt(receipt.requestId);
    if (!current || !sameUpdateIntent(current, receipt)) throw lifecycleError("skill.update_receipt_conflict");
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== registryRevision) throw lifecycleError("skill.update_receipt_conflict");
      return current;
    }
    const committed: SkillUpdateReceipt = { ...current, state: "committed", committedRegistryRevision: registryRevision };
    writeJsonAtomic(path.join(this.#updateEntry(receipt.requestId), UPDATE_RECEIPT_NAME), committed);
    return committed;
  }

  exportInstalled(skillId: string, expectedSha256: string, destinationPath: string): void {
    const snapshot = this.readInstalled(skillId);
    if (snapshot.sha256 !== expectedSha256) throw lifecycleError("skill.manifest_changed");
    writePrivateExport(destinationPath, snapshot.bytes);
  }

  #publishUninstallReceipt(receipt: SkillUninstallReceipt): SkillUninstallReceipt {
    const destination = this.#trashEntry(receipt.requestId);
    const temporaryPath = path.join(this.#trashRoot, `.uninstall.${receipt.requestId}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      writePrivateFile(path.join(temporaryPath, UNINSTALL_RECEIPT_NAME), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
      fsyncDirectory(temporaryPath);
      fs.renameSync(temporaryPath, destination);
      renamed = true;
      fsyncDirectory(this.#trashRoot);
      return this.readUninstallReceipt(receipt.requestId) ?? receipt;
    } finally {
      if (!renamed) fs.rmSync(temporaryPath, { recursive: true, force: true });
    }
  }

  #publishUpdateReceipt(
    receipt: SkillUpdateReceipt,
    bytes: Buffer,
    files?: readonly SkillBundleFile[],
    externalInstallReceipt?: SkillInstallReceipt
  ): SkillUpdateReceipt {
    const destination = this.#updateEntry(receipt.requestId);
    const temporaryPath = path.join(this.#updateRoot, `.update.${receipt.requestId}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      const replacementPath = path.join(temporaryPath, "replacement");
      fs.mkdirSync(replacementPath, { mode: 0o700 });
      if (receipt.schemaVersion === 2) {
        if (!files || !externalInstallReceipt) throw lifecycleError("skill.update_payload_changed");
        writeBundleFiles(replacementPath, files);
      } else writePrivateFile(path.join(replacementPath, "SKILL.md"), bytes);
      const installReceipt: SkillInstallReceipt = receipt.schemaVersion === 2 ? externalInstallReceipt! : {
        schemaVersion: 1, requestId: receipt.requestId, stagingId: receipt.stagingId,
        manifestSha256: receipt.newManifestSha256, bundleSha256: receipt.newManifestSha256, enabled: receipt.enabled
      };
      writePrivateFile(path.join(replacementPath, INSTALL_RECEIPT_NAME), Buffer.from(`${JSON.stringify(installReceipt)}\n`, "utf8"));
      writePrivateFile(path.join(temporaryPath, UPDATE_RECEIPT_NAME), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
      fsyncTree(replacementPath);
      fsyncDirectory(temporaryPath);
      fs.renameSync(temporaryPath, destination);
      renamed = true;
      fsyncDirectory(this.#updateRoot);
      return this.readUpdateReceipt(receipt.requestId) ?? receipt;
    } finally {
      if (!renamed) fs.rmSync(temporaryPath, { recursive: true, force: true });
    }
  }

  #trashEntry(requestId: string): string {
    const candidate = path.join(this.#trashRoot, SkillLifecycleRequestIdSchema.parse(requestId));
    if (path.dirname(candidate) !== this.#trashRoot) throw lifecycleError("skill.registry_path_escape");
    return candidate;
  }

  #updateEntry(requestId: string): string {
    const candidate = path.join(this.#updateRoot, SkillInstallRequestIdSchema.parse(requestId));
    if (path.dirname(candidate) !== this.#updateRoot) throw lifecycleError("skill.registry_path_escape");
    return candidate;
  }
}

export function readManifestDirectory(parentRoot: string, directory: string): InstalledSkillSnapshot {
  assertChildDirectory(parentRoot, directory);
  const files = readBundleTree(directory);
  const manifest = files.find((file) => file.relativePath === "SKILL.md");
  if (!manifest) throw lifecycleError("skill.manifest_invalid");
  return { bytes: manifest.bytes, sha256: manifest.sha256, bundleSha256: skillBundleSha256(files), files };
}

function writeBundleFiles(root: string, files: readonly SkillBundleFile[]): void {
  for (const file of normalizeBundleFiles(files)) {
    const destination = path.join(root, ...file.relativePath.split("/"));
    if (!destination.startsWith(`${root}${path.sep}`)) throw lifecycleError("skill.registry_path_escape");
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    let cursor = parent;
    while (cursor !== root) {
      assertOwnedDirectory(cursor);
      cursor = path.dirname(cursor);
    }
    writePrivateFile(destination, file.bytes);
  }
}

function readBundleTree(root: string): readonly SkillBundleFile[] {
  const files: SkillBundleFile[] = [];
  const visit = (directory: string, prefix: string): void => {
    assertOwnedDirectory(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (prefix === "" && [INSTALL_RECEIPT_NAME, UNINSTALL_RECEIPT_NAME, UPDATE_RECEIPT_NAME].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stats = fs.lstatSync(absolute);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw lifecycleError("skill.bundle_invalid");
      if (entry.isDirectory() && stats.isDirectory()) {
        const beforeCount = files.length;
        visit(absolute, relativePath);
        if (files.length === beforeCount) throw lifecycleError("skill.bundle_invalid");
        continue;
      }
      if (!entry.isFile() || !stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > MAX_MANIFEST_BYTES) {
        throw lifecycleError("skill.bundle_invalid");
      }
      const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const before = fs.fstatSync(descriptor);
        const bytes = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        if (!sameFileIdentity(before, after) || bytes.length !== before.size) throw lifecycleError("skill.bundle_changed");
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        files.push({ relativePath, bytes, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
      } catch (caught) {
        if (caught instanceof TypeError) throw lifecycleError("skill.bundle_invalid");
        throw caught;
      } finally {
        fs.closeSync(descriptor);
      }
    }
  };
  visit(root, "");
  try { return normalizeBundleFiles(files); } catch { throw lifecycleError("skill.bundle_invalid"); }
}

function fsyncTree(root: string): void {
  const directories: string[] = [];
  const visit = (directory: string): void => {
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) visit(path.join(directory, entry.name));
    }
  };
  visit(root);
  for (const directory of directories.reverse()) fsyncDirectory(directory);
}

export function parseInstallReceipt(source: string): SkillInstallReceipt {
  const record = parseJsonObject(source, "skill.install_receipt_invalid");
  const keys = Object.keys(record).sort().join(",");
  const legacyKeys = ["bundleSha256,enabled,manifestSha256,requestId,schemaVersion,stagingId",
    "enabled,manifestSha256,requestId,schemaVersion,stagingId"];
  const externalKeys = [
    "bundleSha256,enabled,manifestSha256,requestId,schemaVersion,source,stagingId,warnings",
    "bundleSha256,enabled,manifestSha256,requestId,schemaVersion,source,sourceUrl,stagingId,warnings"
  ];
  if (![...legacyKeys, ...externalKeys].includes(keys) ||
    record.schemaVersion !== 1 || typeof record.requestId !== "string" || typeof record.stagingId !== "string" ||
    typeof record.manifestSha256 !== "string" || typeof record.enabled !== "boolean") {
    throw lifecycleError("skill.install_receipt_invalid");
  }
  const bundleSha256 = typeof record.bundleSha256 === "string" ? record.bundleSha256 : record.manifestSha256;
  if (!/^sha256:[a-f0-9]{64}$/u.test(bundleSha256)) throw lifecycleError("skill.install_receipt_invalid");
  if (externalKeys.includes(keys)) {
    const parsedSource = SkillInstallSourceKindSchema.safeParse(record.source);
    const parsedWarnings = Array.isArray(record.warnings)
      ? record.warnings.map((warning) => SkillStageWarningSchema.safeParse(warning))
      : [];
    const sourceUrl = record.sourceUrl === undefined ? undefined : SkillInstallUrlSchema.safeParse(record.sourceUrl);
    const remote = parsedSource.success && parsedSource.data === "https";
    if (!parsedSource.success || record.enabled || parsedWarnings.length !== (record.warnings as unknown[]).length ||
      parsedWarnings.some((warning) => !warning.success) ||
      new Set(record.warnings as unknown[]).size !== (record.warnings as unknown[]).length ||
      remote !== Boolean(sourceUrl?.success) ||
      (remote && !parsedWarnings.some((warning) => warning.success && warning.data === "untrusted_remote_source")) ||
      (!remote && parsedWarnings.some((warning) => warning.success && warning.data === "untrusted_remote_source"))) {
      throw lifecycleError("skill.install_receipt_invalid");
    }
  }
  return { ...(record as unknown as Omit<SkillInstallReceipt, "bundleSha256">), bundleSha256 };
}

function parseUninstallReceipt(source: string): SkillUninstallReceipt {
  const record = parseJsonObject(source, "skill.uninstall_receipt_invalid");
  const v2 = record.schemaVersion === 2;
  const baseKeys = record.state === "committed"
    ? "activeVaultId,committedRegistryRevision,createdAt,expectedRegistryRevision,manifestSha256,record,requestId,schemaVersion,skillId,state"
    : "activeVaultId,createdAt,expectedRegistryRevision,manifestSha256,record,requestId,schemaVersion,skillId,state";
  const expectedKeys = v2
    ? [...baseKeys.split(","), "bundleSha256", "installReceiptSha256"].sort().join(",")
    : baseKeys;
  if (Object.keys(record).sort().join(",") !== expectedKeys || (!v2 && record.schemaVersion !== 1) ||
    (record.state !== "prepared" && record.state !== "committed") ||
    !SkillLifecycleRequestIdSchema.safeParse(record.requestId).success || !VaultIdSchema.safeParse(record.activeVaultId).success ||
    !SkillIdSchema.safeParse(record.skillId).success || !Number.isSafeInteger(record.expectedRegistryRevision) ||
    Number(record.expectedRegistryRevision) < 0 || typeof record.manifestSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.manifestSha256) || typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) || !SkillRegistryRecordSchema.safeParse(record.record).success ||
    (v2 && (typeof record.bundleSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.bundleSha256) ||
      typeof record.installReceiptSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(record.installReceiptSha256))) ||
    (record.state === "committed" && (!Number.isSafeInteger(record.committedRegistryRevision) ||
      Number(record.committedRegistryRevision) !== Number(record.expectedRegistryRevision) + 1))) {
    throw lifecycleError("skill.uninstall_receipt_invalid");
  }
  const parsed = record as unknown as SkillUninstallReceipt;
  if (parsed.skillId !== parsed.record.id || parsed.manifestSha256 !== parsed.record.manifestSha256) {
    throw lifecycleError("skill.uninstall_receipt_invalid");
  }
  return parsed;
}

function parseUpdateReceipt(source: string): SkillUpdateReceipt {
  const record = parseJsonObject(source, "skill.update_receipt_invalid");
  const baseKeys = record.state === "committed"
    ? "activeVaultId,committedRegistryRevision,createdAt,enabled,expectedRegistryRevision,newManifestSha256,newVersion,oldRecord,requestId,schemaVersion,skillId,stagingId,state"
    : "activeVaultId,createdAt,enabled,expectedRegistryRevision,newManifestSha256,newVersion,oldRecord,requestId,schemaVersion,skillId,stagingId,state";
  const v2 = record.schemaVersion === 2;
  const expectedKeys = v2
    ? [...baseKeys.split(","), "oldBundleSha256", "oldInstallReceiptSha256", "newBundleSha256", "newInstallReceiptSha256"].sort().join(",")
    : baseKeys;
  if (Object.keys(record).sort().join(",") !== expectedKeys || (!v2 && record.schemaVersion !== 1) ||
    (record.state !== "prepared" && record.state !== "committed") ||
    !SkillInstallRequestIdSchema.safeParse(record.requestId).success || !SkillStagingIdSchema.safeParse(record.stagingId).success ||
    !VaultIdSchema.safeParse(record.activeVaultId).success || !SkillIdSchema.safeParse(record.skillId).success ||
    !Number.isSafeInteger(record.expectedRegistryRevision) || Number(record.expectedRegistryRevision) < 0 ||
    !SkillRegistryRecordSchema.safeParse(record.oldRecord).success || typeof record.newManifestSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.newManifestSha256) || typeof record.newVersion !== "string" ||
    typeof record.enabled !== "boolean" || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
    (v2 && [record.oldBundleSha256, record.oldInstallReceiptSha256, record.newBundleSha256,
      record.newInstallReceiptSha256].some((digest) => typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest))) ||
    (record.state === "committed" && (!Number.isSafeInteger(record.committedRegistryRevision) ||
      Number(record.committedRegistryRevision) !== Number(record.expectedRegistryRevision) + 1))) {
    throw lifecycleError("skill.update_receipt_invalid");
  }
  const parsed = record as unknown as SkillUpdateReceipt;
  if (parsed.skillId !== parsed.oldRecord.id ||
    (parsed.schemaVersion === 1 && parsed.enabled !== parsed.oldRecord.enabled) ||
    (parsed.schemaVersion === 2 && parsed.enabled !== false) ||
    parsed.newManifestSha256 === parsed.oldRecord.manifestSha256) throw lifecycleError("skill.update_receipt_invalid");
  return parsed;
}

function sameUninstallIntent(left: SkillUninstallReceipt, right: SkillUninstallReceipt): boolean {
  return left.requestId === right.requestId && left.activeVaultId === right.activeVaultId &&
    left.skillId === right.skillId && left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.manifestSha256 === right.manifestSha256 && left.schemaVersion === right.schemaVersion &&
    (left.schemaVersion !== 2 || (right.schemaVersion === 2 && left.bundleSha256 === right.bundleSha256 &&
      left.installReceiptSha256 === right.installReceiptSha256)) && stableJson(left.record) === stableJson(right.record);
}

function sameUpdateIntent(left: SkillUpdateReceipt, right: SkillUpdateReceipt): boolean {
  return left.requestId === right.requestId && left.stagingId === right.stagingId &&
    left.activeVaultId === right.activeVaultId && left.skillId === right.skillId &&
    left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.newManifestSha256 === right.newManifestSha256 && left.newVersion === right.newVersion &&
    left.enabled === right.enabled && left.schemaVersion === right.schemaVersion &&
    (left.schemaVersion !== 2 || (right.schemaVersion === 2 &&
      left.oldBundleSha256 === right.oldBundleSha256 &&
      left.oldInstallReceiptSha256 === right.oldInstallReceiptSha256 &&
      left.newBundleSha256 === right.newBundleSha256 &&
      left.newInstallReceiptSha256 === right.newInstallReceiptSha256)) &&
    stableJson(left.oldRecord) === stableJson(right.oldRecord);
}

function writePrivateExport(destinationPath: string, bytes: Buffer): void {
  if (!path.isAbsolute(destinationPath)) throw lifecycleError("skill.export_destination_invalid");
  const parent = path.dirname(destinationPath);
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw lifecycleError("skill.export_destination_invalid");
  const parentReal = fs.realpathSync.native(parent);
  if (path.resolve(parentReal) !== path.resolve(parent)) throw lifecycleError("skill.export_destination_invalid");
  let destinationIdentity = readLstatOptional(destinationPath);
  if (destinationIdentity) {
    const destinationStats = destinationIdentity;
    if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) throw lifecycleError("skill.export_destination_invalid");
    destinationIdentity = destinationStats;
  }
  const temporaryPath = path.join(parent, `.${path.basename(destinationPath)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const parentAfter = fs.lstatSync(parent);
    if (!sameDirectoryIdentity(parentStats, parentAfter) || fs.realpathSync.native(parent) !== parentReal) {
      throw lifecycleError("skill.export_destination_invalid");
    }
    const currentDestination = readLstatOptional(destinationPath);
    if (destinationIdentity) {
      if (!currentDestination || currentDestination.isSymbolicLink() || !currentDestination.isFile() ||
        !sameFileIdentity(destinationIdentity, currentDestination)) throw lifecycleError("skill.export_destination_invalid");
    } else if (currentDestination) throw lifecycleError("skill.export_destination_invalid");
    fs.renameSync(temporaryPath, destinationPath);
    fs.chmodSync(destinationPath, 0o600);
    fsyncDirectory(parent);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const current = readLstatOptional(filePath);
    if (current && (!current.isFile() || current.isSymbolicLink())) throw lifecycleError("skill.uninstall_receipt_invalid");
    fs.renameSync(temporaryPath, filePath);
    fsyncDirectory(path.dirname(filePath));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function readBoundedNoFollow(filePath: string, maximumBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) throw lifecycleError("skill.registry_file_invalid");
    return fs.readFileSync(descriptor, "utf8");
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readLstatOptional(filePath: string): fs.Stats | undefined {
  try { return fs.lstatSync(filePath); } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw caught;
  }
}

function writePrivateFile(filePath: string, bytes: Buffer): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function createOwnedDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertOwnedDirectory(directory);
}

function assertOwnedDirectory(directory: string): void {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) {
    throw lifecycleError("skill.registry_root_invalid");
  }
}

function assertChildDirectory(parent: string, directory: string): void {
  if (path.dirname(directory) !== parent) throw lifecycleError("skill.registry_path_escape");
  assertOwnedDirectory(directory);
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function sameDirectoryIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.isDirectory() && right.isDirectory();
}

export function fsyncDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!["EBADF", "EINVAL", "EISDIR", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"]
      .includes((caught as NodeJS.ErrnoException).code ?? "")) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseJsonObject(source: string, code: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw lifecycleError(code); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError(code);
  return value as Record<string, unknown>;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function digestStableJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}


function isPermissionCapability(value: string): boolean {
  return [
    "read_vault", "write_vault", "delete_vault", "external_filesystem", "external_network", "run_shell",
    "install_package", "install_local_tool", "call_cloud_model_with_private_or_large_source",
    "use_brokered_credential", "change_settings", "change_pige_schema", "spawn_agent"
  ].includes(value);
}

function digestRuntimeIdentity(value: Readonly<Record<string, unknown>>): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update("pige.external_web_skill.runtime_identity.v1\0", "utf8")
    .update(stableJson(value), "utf8")
    .digest("hex")}`;
}

function lifecycleError(code: string): Error {
  const error = new Error(code);
  error.name = "SkillRegistryLifecycleStoreError";
  return error;
}
