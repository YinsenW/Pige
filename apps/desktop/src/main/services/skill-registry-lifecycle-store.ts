import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SkillIdSchema,
  SkillInstallRequestIdSchema,
  SkillLifecycleRequestIdSchema,
  SkillRegistryRecordSchema,
  SkillStagingIdSchema,
  VaultIdSchema,
  type SkillRegistryRecord
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
}

export interface InstalledSkillSnapshot {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly bundleSha256: string;
  readonly files: readonly SkillBundleFile[];
}

export interface SkillUninstallReceipt {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
  readonly committedRegistryRevision?: number;
  readonly record: SkillRegistryRecord;
  readonly manifestSha256: string;
  readonly createdAt: string;
}

export interface SkillUpdateReceipt {
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

export function lifecycleRequestIdentity(request: {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly skillId: string;
}) {
  return { apiVersion: 1 as const, requestId: request.requestId, activeVaultId: request.activeVaultId, skillId: request.skillId };
}

export function matchesUninstallRequest(receipt: SkillUninstallReceipt, request: {
  readonly requestId: string;
  readonly activeVaultId: string;
  readonly skillId: string;
  readonly expectedRegistryRevision: number;
}): boolean {
  return receipt.requestId === request.requestId && receipt.activeVaultId === request.activeVaultId &&
    receipt.skillId === request.skillId && receipt.expectedRegistryRevision === request.expectedRegistryRevision;
}

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
    readonly requestId: string;
    readonly activeVaultId: string;
    readonly expectedRegistryRevision: number;
    readonly record: SkillRegistryRecord;
    readonly createdAt: string;
  }): SkillUninstallReceipt {
    this.prepare();
    const requestId = SkillLifecycleRequestIdSchema.parse(input.requestId);
    const record = SkillRegistryRecordSchema.parse(input.record);
    const existing = this.readUninstallReceipt(requestId);
    const manifestSha256 = existing?.manifestSha256 ?? this.readInstalled(record.id).sha256;
    if (manifestSha256 !== record.manifestSha256) throw lifecycleError("skill.manifest_changed");
    const expected: SkillUninstallReceipt = {
      schemaVersion: 1,
      state: "prepared",
      requestId,
      activeVaultId: input.activeVaultId,
      skillId: record.id,
      expectedRegistryRevision: input.expectedRegistryRevision,
      record,
      manifestSha256,
      createdAt: input.createdAt
    };
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
    this.prepare();
    const receipts: SkillUninstallReceipt[] = [];
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SkillLifecycleRequestIdSchema.safeParse(entry.name).success) continue;
      const receipt = this.readUninstallReceipt(entry.name);
      if (receipt?.state === "prepared") receipts.push(receipt);
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
    readonly createdAt: string;
  }): SkillUpdateReceipt {
    this.prepare();
    const requestId = SkillInstallRequestIdSchema.parse(input.requestId);
    const oldRecord = SkillRegistryRecordSchema.parse(input.oldRecord);
    if (`sha256:${createHash("sha256").update(input.bytes).digest("hex")}` !== input.newManifestSha256) {
      throw lifecycleError("skill.update_payload_changed");
    }
    const expected: SkillUpdateReceipt = {
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
    };
    const existing = this.readUpdateReceipt(requestId);
    const receipt = existing ?? this.#publishUpdateReceipt(expected, input.bytes);
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
    if (!fs.existsSync(installedPath)) {
      if (!fs.existsSync(replacementPath) || readManifestDirectory(receiptDirectory, replacementPath).sha256 !== receipt.newManifestSha256) {
        throw lifecycleError("skill.update_payload_missing");
      }
      fs.renameSync(replacementPath, installedPath);
      fsyncDirectory(receiptDirectory);
      fsyncDirectory(this.#installedRoot);
    }
    if (this.readInstalled(receipt.skillId).sha256 !== receipt.newManifestSha256) {
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

  #publishUpdateReceipt(receipt: SkillUpdateReceipt, bytes: Buffer): SkillUpdateReceipt {
    const destination = this.#updateEntry(receipt.requestId);
    const temporaryPath = path.join(this.#updateRoot, `.update.${receipt.requestId}.${randomUUID()}.tmp`);
    let renamed = false;
    try {
      fs.mkdirSync(temporaryPath, { mode: 0o700 });
      const replacementPath = path.join(temporaryPath, "replacement");
      fs.mkdirSync(replacementPath, { mode: 0o700 });
      writePrivateFile(path.join(replacementPath, "SKILL.md"), bytes);
      const installReceipt: SkillInstallReceipt = {
        schemaVersion: 1,
        requestId: receipt.requestId,
        stagingId: receipt.stagingId,
        manifestSha256: receipt.newManifestSha256,
        bundleSha256: receipt.newManifestSha256,
        enabled: receipt.enabled
      };
      writePrivateFile(path.join(replacementPath, INSTALL_RECEIPT_NAME), Buffer.from(`${JSON.stringify(installReceipt)}\n`, "utf8"));
      writePrivateFile(path.join(temporaryPath, UPDATE_RECEIPT_NAME), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
      fsyncDirectory(replacementPath);
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

function readManifestDirectory(parentRoot: string, directory: string): InstalledSkillSnapshot {
  assertChildDirectory(parentRoot, directory);
  const files = readBundleTree(directory);
  const manifest = files.find((file) => file.relativePath === "SKILL.md");
  if (!manifest) throw lifecycleError("skill.manifest_invalid");
  return { bytes: manifest.bytes, sha256: manifest.sha256, bundleSha256: skillBundleSha256(files), files };
}

function parseInstallReceipt(source: string): SkillInstallReceipt {
  const record = parseJsonObject(source, "skill.install_receipt_invalid");
  const keys = Object.keys(record).sort().join(",");
  if (!["bundleSha256,enabled,manifestSha256,requestId,schemaVersion,stagingId",
    "enabled,manifestSha256,requestId,schemaVersion,stagingId"].includes(keys) ||
    record.schemaVersion !== 1 || typeof record.requestId !== "string" || typeof record.stagingId !== "string" ||
    typeof record.manifestSha256 !== "string" || typeof record.enabled !== "boolean") {
    throw lifecycleError("skill.install_receipt_invalid");
  }
  const bundleSha256 = typeof record.bundleSha256 === "string" ? record.bundleSha256 : record.manifestSha256;
  if (!/^sha256:[a-f0-9]{64}$/u.test(bundleSha256)) throw lifecycleError("skill.install_receipt_invalid");
  return { ...(record as unknown as Omit<SkillInstallReceipt, "bundleSha256">), bundleSha256 };
}

function parseUninstallReceipt(source: string): SkillUninstallReceipt {
  const record = parseJsonObject(source, "skill.uninstall_receipt_invalid");
  const expectedKeys = record.state === "committed"
    ? "activeVaultId,committedRegistryRevision,createdAt,expectedRegistryRevision,manifestSha256,record,requestId,schemaVersion,skillId,state"
    : "activeVaultId,createdAt,expectedRegistryRevision,manifestSha256,record,requestId,schemaVersion,skillId,state";
  if (Object.keys(record).sort().join(",") !== expectedKeys || record.schemaVersion !== 1 ||
    (record.state !== "prepared" && record.state !== "committed") ||
    !SkillLifecycleRequestIdSchema.safeParse(record.requestId).success || !VaultIdSchema.safeParse(record.activeVaultId).success ||
    !SkillIdSchema.safeParse(record.skillId).success || !Number.isSafeInteger(record.expectedRegistryRevision) ||
    Number(record.expectedRegistryRevision) < 0 || typeof record.manifestSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.manifestSha256) || typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) || !SkillRegistryRecordSchema.safeParse(record.record).success ||
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
  const expectedKeys = record.state === "committed"
    ? "activeVaultId,committedRegistryRevision,createdAt,enabled,expectedRegistryRevision,newManifestSha256,newVersion,oldRecord,requestId,schemaVersion,skillId,stagingId,state"
    : "activeVaultId,createdAt,enabled,expectedRegistryRevision,newManifestSha256,newVersion,oldRecord,requestId,schemaVersion,skillId,stagingId,state";
  if (Object.keys(record).sort().join(",") !== expectedKeys || record.schemaVersion !== 1 ||
    (record.state !== "prepared" && record.state !== "committed") ||
    !SkillInstallRequestIdSchema.safeParse(record.requestId).success || !SkillStagingIdSchema.safeParse(record.stagingId).success ||
    !VaultIdSchema.safeParse(record.activeVaultId).success || !SkillIdSchema.safeParse(record.skillId).success ||
    !Number.isSafeInteger(record.expectedRegistryRevision) || Number(record.expectedRegistryRevision) < 0 ||
    !SkillRegistryRecordSchema.safeParse(record.oldRecord).success || typeof record.newManifestSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(record.newManifestSha256) || typeof record.newVersion !== "string" ||
    typeof record.enabled !== "boolean" || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
    (record.state === "committed" && (!Number.isSafeInteger(record.committedRegistryRevision) ||
      Number(record.committedRegistryRevision) !== Number(record.expectedRegistryRevision) + 1))) {
    throw lifecycleError("skill.update_receipt_invalid");
  }
  const parsed = record as unknown as SkillUpdateReceipt;
  if (parsed.skillId !== parsed.oldRecord.id || parsed.enabled !== parsed.oldRecord.enabled ||
    parsed.newManifestSha256 === parsed.oldRecord.manifestSha256) throw lifecycleError("skill.update_receipt_invalid");
  return parsed;
}

function sameUninstallIntent(left: SkillUninstallReceipt, right: SkillUninstallReceipt): boolean {
  return left.requestId === right.requestId && left.activeVaultId === right.activeVaultId &&
    left.skillId === right.skillId && left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.manifestSha256 === right.manifestSha256 && stableJson(left.record) === stableJson(right.record);
}

function sameUpdateIntent(left: SkillUpdateReceipt, right: SkillUpdateReceipt): boolean {
  return left.requestId === right.requestId && left.stagingId === right.stagingId &&
    left.activeVaultId === right.activeVaultId && left.skillId === right.skillId &&
    left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.newManifestSha256 === right.newManifestSha256 && left.newVersion === right.newVersion &&
    left.enabled === right.enabled && stableJson(left.oldRecord) === stableJson(right.oldRecord);
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

function writeJsonAtomic(filePath: string, value: unknown): void {
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

function readBoundedNoFollow(filePath: string, maximumBytes: number): string | undefined {
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

function fsyncDirectory(directory: string): void {
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function lifecycleError(code: string): Error {
  const error = new Error(code);
  error.name = "SkillRegistryLifecycleStoreError";
  return error;
}
