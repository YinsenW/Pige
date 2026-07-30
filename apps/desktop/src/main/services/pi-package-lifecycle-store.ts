import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const OWNER_MARKER = ".pige-package-owner.json";
const RECEIPT_NAME = ".pige-package-uninstall.json";
const RESTORE_RECEIPT_NAME = ".pige-package-restore.json";
const UPDATE_RECEIPT_NAME = ".pige-package-update.json";
const MAX_RECEIPT_BYTES = 1024 * 1024;
const REQUEST_PATTERN = /^pi_package_uninstall_request_[a-z0-9]{16,64}$/u;
const UPDATE_REQUEST_PATTERN = /^pi_package_update_request_[a-z0-9]{16,64}$/u;
const ROLLBACK_REQUEST_PATTERN = /^pi_package_rollback_request_[a-z0-9]{16,64}$/u;
const ROLLBACK_ID_PATTERN = /^pi_package_rollback_[a-z0-9]{16,64}$/u;
const RESTORE_REQUEST_PATTERN = /^pi_package_restore_request_[a-z0-9]{16,64}$/u;
const RESTORE_CONTEXT_PATTERN = /^pi_package_restore_context_v1_[a-f0-9]{32,64}$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface PiPackageLifecycleRecord {
  readonly packageId: string;
  readonly packageName: string;
  readonly version: string;
  readonly treeHash: string;
  readonly relativePath: string;
}

export interface PiPackageUninstallReceipt<T extends PiPackageLifecycleRecord> {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly packageId: string;
  readonly expectedRegistryRevision: number;
  readonly record: T;
  readonly createdAt: string;
  readonly committedRegistryRevision?: number;
}

export interface PiPackageUpdateReceipt<T extends PiPackageLifecycleRecord> {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed" | "rollback_prepared" | "rolled_back" | "superseded";
  readonly requestId: string;
  readonly rollbackId: string;
  readonly packageId: string;
  readonly expectedRegistryRevision: number;
  readonly previousRecord: T;
  readonly nextRecord: T;
  readonly createdAt: string;
  readonly committedRegistryRevision?: number;
  readonly rollbackRequestId?: string;
  readonly rollbackExpectedRegistryRevision?: number;
  readonly rolledBackRegistryRevision?: number;
}

export interface PiPackageRestoreReceipt<T extends PiPackageLifecycleRecord> {
  readonly schemaVersion: 1;
  readonly state: "prepared" | "committed";
  readonly requestId: string;
  readonly restoreContextId: string;
  readonly packageId: string;
  readonly expectedRegistryRevision: number;
  readonly uninstallRequestId: string;
  readonly uninstallReceiptHash: string;
  readonly record: T;
  readonly createdAt: string;
  readonly committedRegistryRevision?: number;
}

export interface PiPackageLifecycleStoreOptions<T extends PiPackageLifecycleRecord> {
  readonly packageRoot: string;
  readonly installedRoot: string;
  readonly parseRecord: (value: unknown) => T;
}

export class PiPackageLifecycleStore<T extends PiPackageLifecycleRecord> {
  readonly #packageRoot: string;
  readonly #installedRoot: string;
  readonly #trashRoot: string;
  readonly #updatesRoot: string;
  readonly #parseRecord: (value: unknown) => T;

  constructor(options: PiPackageLifecycleStoreOptions<T>) {
    this.#packageRoot = options.packageRoot;
    this.#installedRoot = options.installedRoot;
    this.#trashRoot = path.join(options.packageRoot, "trash");
    this.#updatesRoot = path.join(options.packageRoot, "updates");
    this.#parseRecord = options.parseRecord;
    this.prepare();
  }

  prepare(): void {
    assertDirectory(this.#packageRoot, this.#installedRoot);
    if (!fs.existsSync(this.#trashRoot)) fs.mkdirSync(this.#trashRoot, { mode: 0o700 });
    if (!fs.existsSync(this.#updatesRoot)) fs.mkdirSync(this.#updatesRoot, { mode: 0o700 });
    assertDirectory(this.#packageRoot, this.#trashRoot);
    assertDirectory(this.#packageRoot, this.#updatesRoot);
    let removedTemporary = false;
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^pi_package_uninstall_request_[a-z0-9]{16,64}\.[0-9a-f-]{36}\.tmp$/u.test(entry.name)) continue;
      const temporary = path.join(this.#trashRoot, entry.name);
      assertDirectory(this.#trashRoot, temporary);
      fs.rmSync(temporary, { recursive: true });
      removedTemporary = true;
    }
    if (removedTemporary) fsyncDirectory(this.#trashRoot);
    for (const entry of fs.readdirSync(this.#updatesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^pi_package_rollback_[a-z0-9]{16,64}\.[0-9a-f-]{36}\.tmp$/u.test(entry.name)) continue;
      const temporary = path.join(this.#updatesRoot, entry.name);
      assertDirectory(this.#updatesRoot, temporary);
      fs.rmSync(temporary, { recursive: true });
      removedTemporary = true;
    }
    if (removedTemporary) fsyncDirectory(this.#updatesRoot);
  }

  assertInstalled(record: T): void {
    const installedPath = this.#installedPath(record);
    assertDirectory(this.#installedRoot, installedPath);
    if (fs.existsSync(path.join(installedPath, OWNER_MARKER))) throw lifecycleError("package.install_changed");
    assertTreeHash(installedPath, record.treeHash);
  }

  prepareUninstall(input: {
    readonly requestId: string;
    readonly packageId: string;
    readonly expectedRegistryRevision: number;
    readonly record: T;
    readonly createdAt: string;
  }): PiPackageUninstallReceipt<T> {
    assertRequestId(input.requestId);
    const record = this.#parseRecord(input.record);
    if (input.packageId !== record.packageId || !Number.isSafeInteger(input.expectedRegistryRevision) || input.expectedRegistryRevision < 0) {
      throw lifecycleError("package.uninstall_receipt_invalid");
    }
    this.assertInstalled(record);
    const expected: PiPackageUninstallReceipt<T> = {
      schemaVersion: 1,
      state: "prepared",
      requestId: input.requestId,
      packageId: input.packageId,
      expectedRegistryRevision: input.expectedRegistryRevision,
      record,
      createdAt: input.createdAt
    };
    const existing = this.readUninstallReceipt(input.requestId);
    if (existing) {
      if (!sameIntent(existing, expected)) throw lifecycleError("package.uninstall_receipt_conflict");
      return existing;
    }
    const target = this.#receiptDirectory(input.requestId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.mkdirSync(temporary, { mode: 0o700 });
    try {
      writePrivateJson(path.join(temporary, RECEIPT_NAME), expected);
      fsyncDirectory(temporary);
      fs.renameSync(temporary, target);
      fsyncDirectory(this.#trashRoot);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    return expected;
  }

  readUninstallReceipt(requestId: string): PiPackageUninstallReceipt<T> | undefined {
    assertRequestId(requestId);
    const directory = this.#receiptDirectory(requestId);
    if (!fs.existsSync(directory)) return undefined;
    assertDirectory(this.#trashRoot, directory);
    const source = readBoundedNoFollow(path.join(directory, RECEIPT_NAME), MAX_RECEIPT_BYTES);
    if (source === undefined) throw lifecycleError("package.uninstall_receipt_invalid");
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw lifecycleError("package.uninstall_receipt_invalid"); }
    return this.#parseReceipt(value, requestId);
  }

  listPreparedUninstalls(): readonly PiPackageUninstallReceipt<T>[] {
    this.prepare();
    const receipts: PiPackageUninstallReceipt<T>[] = [];
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !REQUEST_PATTERN.test(entry.name)) continue;
      const receipt = this.readUninstallReceipt(entry.name);
      if (receipt?.state === "prepared") receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  listUninstallReceipts(): readonly PiPackageUninstallReceipt<T>[] {
    this.prepare();
    const receipts: PiPackageUninstallReceipt<T>[] = [];
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !REQUEST_PATTERN.test(entry.name)) continue;
      const receipt = this.readUninstallReceipt(entry.name);
      if (receipt) receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  assertRestorable(receipt: PiPackageUninstallReceipt<T>): string {
    const current = this.#readMatchingReceipt(receipt);
    if (current.state !== "committed") throw lifecycleError("package.restore_ineligible");
    const directory = this.#receiptDirectory(current.requestId);
    const trashedPath = path.join(directory, "package");
    const installedPath = this.#installedPath(current.record);
    if (!fs.existsSync(trashedPath) || fs.existsSync(installedPath)) throw lifecycleError("package.restore_payload_missing");
    assertDirectory(directory, trashedPath);
    assertTreeHash(trashedPath, current.record.treeHash);
    return trashedPath;
  }

  prepareRestore(input: {
    readonly requestId: string;
    readonly restoreContextId: string;
    readonly expectedRegistryRevision: number;
    readonly uninstallReceipt: PiPackageUninstallReceipt<T>;
    readonly createdAt: string;
  }): PiPackageRestoreReceipt<T> {
    assertRestoreRequestId(input.requestId);
    if (!RESTORE_CONTEXT_PATTERN.test(input.restoreContextId) || !Number.isSafeInteger(input.expectedRegistryRevision) || input.expectedRegistryRevision < 0) {
      throw lifecycleError("package.restore_receipt_invalid");
    }
    const uninstall = this.#readMatchingReceipt(input.uninstallReceipt);
    this.assertRestorable(uninstall);
    const expected: PiPackageRestoreReceipt<T> = {
      schemaVersion: 1,
      state: "prepared",
      requestId: input.requestId,
      restoreContextId: input.restoreContextId,
      packageId: uninstall.packageId,
      expectedRegistryRevision: input.expectedRegistryRevision,
      uninstallRequestId: uninstall.requestId,
      uninstallReceiptHash: hashPiPackageUninstallReceipt(uninstall),
      record: uninstall.record,
      createdAt: input.createdAt
    };
    const existing = this.readRestoreReceipt(uninstall.requestId);
    if (existing) {
      if (!sameRestoreIntent(existing, expected)) throw lifecycleError("package.restore_receipt_conflict");
      return existing;
    }
    writeJsonAtomic(path.join(this.#receiptDirectory(uninstall.requestId), RESTORE_RECEIPT_NAME), expected);
    return expected;
  }

  readRestoreReceipt(uninstallRequestId: string): PiPackageRestoreReceipt<T> | undefined {
    assertRequestId(uninstallRequestId);
    const source = readBoundedNoFollow(path.join(this.#receiptDirectory(uninstallRequestId), RESTORE_RECEIPT_NAME), MAX_RECEIPT_BYTES);
    if (source === undefined) return undefined;
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw lifecycleError("package.restore_receipt_invalid"); }
    return this.#parseRestoreReceipt(value, uninstallRequestId);
  }

  listRestoreReceipts(): readonly PiPackageRestoreReceipt<T>[] {
    const receipts: PiPackageRestoreReceipt<T>[] = [];
    for (const uninstall of this.listUninstallReceipts()) {
      const receipt = this.readRestoreReceipt(uninstall.requestId);
      if (receipt) receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  ensureRestored(receipt: PiPackageRestoreReceipt<T>): void {
    const current = this.#readMatchingRestoreReceipt(receipt);
    const uninstall = this.readUninstallReceipt(current.uninstallRequestId);
    if (!uninstall || uninstall.state !== "committed" || hashPiPackageUninstallReceipt(uninstall) !== current.uninstallReceiptHash ||
      !sameLifecycleRecord(uninstall.record, current.record)) throw lifecycleError("package.restore_receipt_conflict");
    const directory = this.#receiptDirectory(current.uninstallRequestId);
    const trashedPath = path.join(directory, "package");
    const installedPath = this.#installedPath(current.record);
    const trashedExists = fs.existsSync(trashedPath);
    const installedExists = fs.existsSync(installedPath);
    if (trashedExists === installedExists) throw lifecycleError("package.restore_path_conflict");
    if (trashedExists) {
      this.assertRestorable(uninstall);
      fs.mkdirSync(path.dirname(installedPath), { recursive: true, mode: 0o700 });
      fs.renameSync(trashedPath, installedPath);
      fsyncDirectory(directory);
      fsyncDirectory(path.dirname(installedPath));
    }
    this.assertInstalled(current.record);
  }

  markRestoreCommitted(receipt: PiPackageRestoreReceipt<T>, revision: number): PiPackageRestoreReceipt<T> {
    const current = this.#readMatchingRestoreReceipt(receipt);
    if (!Number.isSafeInteger(revision) || revision !== current.expectedRegistryRevision + 1) {
      throw lifecycleError("package.restore_receipt_invalid");
    }
    this.ensureRestored(current);
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== revision) throw lifecycleError("package.restore_receipt_conflict");
      return current;
    }
    const committed: PiPackageRestoreReceipt<T> = { ...current, state: "committed", committedRegistryRevision: revision };
    writeJsonAtomic(path.join(this.#receiptDirectory(current.uninstallRequestId), RESTORE_RECEIPT_NAME), committed);
    return committed;
  }

  ensureTrashed(receipt: PiPackageUninstallReceipt<T>): void {
    const current = this.#readMatchingReceipt(receipt);
    const directory = this.#receiptDirectory(current.requestId);
    const trashedPath = path.join(directory, "package");
    const installedPath = this.#installedPath(current.record);
    const trashedExists = fs.existsSync(trashedPath);
    const installedExists = fs.existsSync(installedPath);
    if (trashedExists && installedExists) throw lifecycleError("package.uninstall_path_conflict");
    if (trashedExists) {
      assertDirectory(directory, trashedPath);
      assertTreeHash(trashedPath, current.record.treeHash);
      return;
    }
    if (!installedExists) throw lifecycleError("package.uninstall_payload_missing");
    this.assertInstalled(current.record);
    fs.renameSync(installedPath, trashedPath);
    fsyncDirectory(path.dirname(installedPath));
    fsyncDirectory(directory);
    assertDirectory(directory, trashedPath);
    assertTreeHash(trashedPath, current.record.treeHash);
  }

  markUninstallCommitted(receipt: PiPackageUninstallReceipt<T>, revision: number): PiPackageUninstallReceipt<T> {
    const current = this.#readMatchingReceipt(receipt);
    if (!Number.isSafeInteger(revision) || revision < 1) throw lifecycleError("package.uninstall_receipt_invalid");
    this.ensureTrashed(current);
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== revision) throw lifecycleError("package.uninstall_receipt_conflict");
      return current;
    }
    const committed: PiPackageUninstallReceipt<T> = { ...current, state: "committed", committedRegistryRevision: revision };
    writeJsonAtomic(path.join(this.#receiptDirectory(current.requestId), RECEIPT_NAME), committed);
    return committed;
  }

  prepareUpdate(input: {
    readonly requestId: string;
    readonly rollbackId: string;
    readonly expectedRegistryRevision: number;
    readonly previousRecord: T;
    readonly nextRecord: T;
    readonly candidatePath: string;
    readonly createdAt: string;
  }): PiPackageUpdateReceipt<T> {
    assertUpdateRequestId(input.requestId);
    assertRollbackId(input.rollbackId);
    const previousRecord = this.#parseRecord(input.previousRecord);
    const nextRecord = this.#parseRecord(input.nextRecord);
    if (
      previousRecord.packageId !== nextRecord.packageId || previousRecord.version === nextRecord.version ||
      !Number.isSafeInteger(input.expectedRegistryRevision) || input.expectedRegistryRevision < 0
    ) throw lifecycleError("package.update_receipt_invalid");
    this.assertInstalled(previousRecord);
    assertTreeHash(input.candidatePath, nextRecord.treeHash);
    const expected: PiPackageUpdateReceipt<T> = {
      schemaVersion: 1, state: "prepared", requestId: input.requestId, rollbackId: input.rollbackId,
      packageId: previousRecord.packageId, expectedRegistryRevision: input.expectedRegistryRevision,
      previousRecord, nextRecord, createdAt: input.createdAt
    };
    const existing = this.readUpdateReceipt(input.rollbackId);
    if (existing) {
      if (!sameUpdateIntent(existing, expected)) throw lifecycleError("package.update_receipt_conflict");
      return existing;
    }
    const target = this.#updateDirectory(input.rollbackId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    fs.mkdirSync(temporary, { mode: 0o700 });
    try {
      writePrivateJson(path.join(temporary, UPDATE_RECEIPT_NAME), expected);
      fs.renameSync(input.candidatePath, path.join(temporary, "candidate"));
      fsyncDirectory(temporary);
      fs.renameSync(temporary, target);
      fsyncDirectory(this.#updatesRoot);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    return expected;
  }

  readUpdateReceipt(rollbackId: string): PiPackageUpdateReceipt<T> | undefined {
    assertRollbackId(rollbackId);
    const directory = this.#updateDirectory(rollbackId);
    if (!fs.existsSync(directory)) return undefined;
    assertDirectory(this.#updatesRoot, directory);
    const source = readBoundedNoFollow(path.join(directory, UPDATE_RECEIPT_NAME), MAX_RECEIPT_BYTES);
    if (source === undefined) throw lifecycleError("package.update_receipt_invalid");
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw lifecycleError("package.update_receipt_invalid"); }
    return this.#parseUpdateReceipt(value, rollbackId);
  }

  listPendingUpdates(): readonly PiPackageUpdateReceipt<T>[] {
    this.prepare();
    return this.#listUpdates().filter((receipt) => receipt.state === "prepared" || receipt.state === "rollback_prepared");
  }

  rollbackTarget(record: T): { readonly rollbackId: string; readonly targetVersion: string } | undefined {
    const receipt = this.#listUpdates().find((candidate) =>
      candidate.state === "committed" && candidate.packageId === record.packageId &&
      sameLifecycleRecord(candidate.nextRecord, record)
    );
    return receipt ? { rollbackId: receipt.rollbackId, targetVersion: receipt.previousRecord.version } : undefined;
  }

  rollbackTargetForRestore(record: T): { readonly rollbackId: string; readonly targetVersion: string } | undefined {
    const receipt = this.#listUpdates().find((candidate) =>
      candidate.state === "committed" && candidate.packageId === record.packageId &&
      sameLifecycleRecordIgnoringPin(candidate.nextRecord, record)
    );
    return receipt ? { rollbackId: receipt.rollbackId, targetVersion: receipt.previousRecord.version } : undefined;
  }

  updateReceiptForRequest(requestId: string): PiPackageUpdateReceipt<T> | undefined {
    assertUpdateRequestId(requestId);
    return this.#listUpdates().find((receipt) => receipt.requestId === requestId);
  }

  ensureUpdated(receipt: PiPackageUpdateReceipt<T>): void {
    const current = this.#readMatchingUpdateReceipt(receipt);
    const directory = this.#updateDirectory(current.rollbackId);
    const priorPath = path.join(directory, "previous");
    const candidatePath = path.join(directory, "candidate");
    const previousInstalledPath = this.#installedPath(current.previousRecord);
    const nextInstalledPath = this.#installedPath(current.nextRecord);
    if (!fs.existsSync(priorPath)) {
      if (!fs.existsSync(previousInstalledPath)) throw lifecycleError("package.update_payload_missing");
      this.assertInstalled(current.previousRecord);
      fs.renameSync(previousInstalledPath, priorPath);
      fsyncDirectory(path.dirname(previousInstalledPath));
      fsyncDirectory(directory);
    }
    assertDirectory(directory, priorPath);
    assertTreeHash(priorPath, current.previousRecord.treeHash);
    if (!fs.existsSync(nextInstalledPath)) {
      if (!fs.existsSync(candidatePath)) throw lifecycleError("package.update_payload_missing");
      assertDirectory(directory, candidatePath);
      assertTreeHash(candidatePath, current.nextRecord.treeHash);
      fs.mkdirSync(path.dirname(nextInstalledPath), { recursive: true, mode: 0o700 });
      fs.renameSync(candidatePath, nextInstalledPath);
      fsyncDirectory(path.dirname(nextInstalledPath));
      fsyncDirectory(directory);
    }
    this.assertInstalled(current.nextRecord);
  }

  markUpdateCommitted(receipt: PiPackageUpdateReceipt<T>, revision: number): PiPackageUpdateReceipt<T> {
    const current = this.#readMatchingUpdateReceipt(receipt);
    if (!Number.isSafeInteger(revision) || revision < 1) throw lifecycleError("package.update_receipt_invalid");
    this.ensureUpdated(current);
    if (current.state === "committed") {
      if (current.committedRegistryRevision !== revision) throw lifecycleError("package.update_receipt_conflict");
      return current;
    }
    if (current.state !== "prepared") throw lifecycleError("package.update_receipt_conflict");
    const committed: PiPackageUpdateReceipt<T> = { ...current, state: "committed", committedRegistryRevision: revision };
    this.#supersedePriorRollbacks(committed);
    this.#writeUpdateReceipt(committed);
    return committed;
  }

  prepareRollback(input: {
    readonly receipt: PiPackageUpdateReceipt<T>;
    readonly requestId: string;
    readonly expectedRegistryRevision: number;
  }): PiPackageUpdateReceipt<T> {
    assertRollbackRequestId(input.requestId);
    const current = this.#readMatchingUpdateReceipt(input.receipt);
    if (current.state === "rollback_prepared") {
      if (current.rollbackRequestId !== input.requestId || current.rollbackExpectedRegistryRevision !== input.expectedRegistryRevision) {
        throw lifecycleError("package.rollback_receipt_conflict");
      }
      return current;
    }
    if (current.state !== "committed" || input.expectedRegistryRevision < current.committedRegistryRevision!) {
      throw lifecycleError("package.rollback_receipt_conflict");
    }
    this.assertInstalled(current.nextRecord);
    const prepared: PiPackageUpdateReceipt<T> = {
      ...current, state: "rollback_prepared", rollbackRequestId: input.requestId,
      rollbackExpectedRegistryRevision: input.expectedRegistryRevision
    };
    this.#writeUpdateReceipt(prepared);
    return prepared;
  }

  ensureRolledBack(receipt: PiPackageUpdateReceipt<T>): void {
    const current = this.#readMatchingUpdateReceipt(receipt);
    if (current.state !== "rollback_prepared" && current.state !== "rolled_back") {
      throw lifecycleError("package.rollback_receipt_conflict");
    }
    const directory = this.#updateDirectory(current.rollbackId);
    const previousPath = path.join(directory, "previous");
    const replacedPath = path.join(directory, "replaced");
    const nextInstalledPath = this.#installedPath(current.nextRecord);
    const previousInstalledPath = this.#installedPath(current.previousRecord);
    if (!fs.existsSync(replacedPath)) {
      if (!fs.existsSync(nextInstalledPath)) throw lifecycleError("package.rollback_payload_missing");
      this.assertInstalled(current.nextRecord);
      fs.renameSync(nextInstalledPath, replacedPath);
      fsyncDirectory(path.dirname(nextInstalledPath));
      fsyncDirectory(directory);
    }
    assertDirectory(directory, replacedPath);
    assertTreeHash(replacedPath, current.nextRecord.treeHash);
    if (!fs.existsSync(previousInstalledPath)) {
      if (!fs.existsSync(previousPath)) throw lifecycleError("package.rollback_payload_missing");
      fs.mkdirSync(path.dirname(previousInstalledPath), { recursive: true, mode: 0o700 });
      fs.renameSync(previousPath, previousInstalledPath);
      fsyncDirectory(path.dirname(previousInstalledPath));
      fsyncDirectory(directory);
    }
    this.assertInstalled(current.previousRecord);
  }

  markRollbackCommitted(receipt: PiPackageUpdateReceipt<T>, revision: number): PiPackageUpdateReceipt<T> {
    const current = this.#readMatchingUpdateReceipt(receipt);
    if (!Number.isSafeInteger(revision) || revision < 1) throw lifecycleError("package.update_receipt_invalid");
    this.ensureRolledBack(current);
    if (current.state === "rolled_back") {
      if (current.rolledBackRegistryRevision !== revision) throw lifecycleError("package.rollback_receipt_conflict");
      return current;
    }
    const committed: PiPackageUpdateReceipt<T> = { ...current, state: "rolled_back", rolledBackRegistryRevision: revision };
    this.#writeUpdateReceipt(committed);
    return committed;
  }

  #installedPath(record: T): string {
    const expected = path.join("installed", record.packageId, record.version, record.treeHash.replace(/^sha256:/u, ""));
    if (!SHA256_PATTERN.test(record.treeHash) || record.relativePath !== expected) {
      throw lifecycleError("package.install_changed");
    }
    const installedPath = path.join(this.#packageRoot, record.relativePath);
    ensureConfined(this.#installedRoot, installedPath);
    return installedPath;
  }

  #receiptDirectory(requestId: string): string {
    const directory = path.join(this.#trashRoot, requestId);
    ensureConfined(this.#trashRoot, directory);
    return directory;
  }

  #updateDirectory(rollbackId: string): string {
    const directory = path.join(this.#updatesRoot, rollbackId);
    ensureConfined(this.#updatesRoot, directory);
    return directory;
  }

  #listUpdates(): readonly PiPackageUpdateReceipt<T>[] {
    const receipts: PiPackageUpdateReceipt<T>[] = [];
    for (const entry of fs.readdirSync(this.#updatesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !ROLLBACK_ID_PATTERN.test(entry.name)) continue;
      const receipt = this.readUpdateReceipt(entry.name);
      if (receipt) receipts.push(receipt);
    }
    return receipts.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  #readMatchingUpdateReceipt(receipt: PiPackageUpdateReceipt<T>): PiPackageUpdateReceipt<T> {
    const current = this.readUpdateReceipt(receipt.rollbackId);
    if (!current || !sameUpdateIntent(current, receipt)) throw lifecycleError("package.update_receipt_conflict");
    return current;
  }

  #writeUpdateReceipt(receipt: PiPackageUpdateReceipt<T>): void {
    writeJsonAtomic(path.join(this.#updateDirectory(receipt.rollbackId), UPDATE_RECEIPT_NAME), receipt);
  }

  #supersedePriorRollbacks(current: PiPackageUpdateReceipt<T>): void {
    for (const receipt of this.#listUpdates()) {
      if (receipt.rollbackId === current.rollbackId || receipt.packageId !== current.packageId || receipt.state !== "committed") continue;
      this.#writeUpdateReceipt({ ...receipt, state: "superseded" });
    }
  }

  #readMatchingReceipt(receipt: PiPackageUninstallReceipt<T>): PiPackageUninstallReceipt<T> {
    const current = this.readUninstallReceipt(receipt.requestId);
    if (!current || !sameIntent(current, receipt)) throw lifecycleError("package.uninstall_receipt_conflict");
    return current;
  }

  #readMatchingRestoreReceipt(receipt: PiPackageRestoreReceipt<T>): PiPackageRestoreReceipt<T> {
    const current = this.readRestoreReceipt(receipt.uninstallRequestId);
    if (!current || !sameRestoreIntent(current, receipt)) throw lifecycleError("package.restore_receipt_conflict");
    return current;
  }

  #parseReceipt(value: unknown, requestId: string): PiPackageUninstallReceipt<T> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("package.uninstall_receipt_invalid");
    const receipt = value as Partial<PiPackageUninstallReceipt<T>>;
    const record = this.#parseRecord(receipt.record);
    if (
      receipt.schemaVersion !== 1 || !["prepared", "committed"].includes(String(receipt.state)) ||
      receipt.requestId !== requestId || receipt.packageId !== record.packageId ||
      !Number.isSafeInteger(receipt.expectedRegistryRevision) || receipt.expectedRegistryRevision! < 0 ||
      typeof receipt.createdAt !== "string" || Number.isNaN(Date.parse(receipt.createdAt)) ||
      (receipt.state === "committed" && (!Number.isSafeInteger(receipt.committedRegistryRevision) || receipt.committedRegistryRevision! < 1)) ||
      (receipt.state === "prepared" && receipt.committedRegistryRevision !== undefined)
    ) throw lifecycleError("package.uninstall_receipt_invalid");
    return { ...receipt, record } as PiPackageUninstallReceipt<T>;
  }

  #parseUpdateReceipt(value: unknown, rollbackId: string): PiPackageUpdateReceipt<T> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("package.update_receipt_invalid");
    const receipt = value as Partial<PiPackageUpdateReceipt<T>>;
    const previousRecord = this.#parseRecord(receipt.previousRecord);
    const nextRecord = this.#parseRecord(receipt.nextRecord);
    const states = ["prepared", "committed", "rollback_prepared", "rolled_back", "superseded"];
    if (
      receipt.schemaVersion !== 1 || !states.includes(String(receipt.state)) || receipt.rollbackId !== rollbackId ||
      typeof receipt.requestId !== "string" || !UPDATE_REQUEST_PATTERN.test(receipt.requestId) ||
      receipt.packageId !== previousRecord.packageId || nextRecord.packageId !== previousRecord.packageId ||
      previousRecord.version === nextRecord.version || !Number.isSafeInteger(receipt.expectedRegistryRevision) ||
      receipt.expectedRegistryRevision! < 0 || typeof receipt.createdAt !== "string" || Number.isNaN(Date.parse(receipt.createdAt))
    ) throw lifecycleError("package.update_receipt_invalid");
    if (receipt.state !== "prepared" && (!Number.isSafeInteger(receipt.committedRegistryRevision) || receipt.committedRegistryRevision! < 1)) {
      throw lifecycleError("package.update_receipt_invalid");
    }
    if (receipt.state !== "prepared" && receipt.committedRegistryRevision !== receipt.expectedRegistryRevision! + 1) {
      throw lifecycleError("package.update_receipt_invalid");
    }
    if (receipt.state === "prepared" && receipt.committedRegistryRevision !== undefined) throw lifecycleError("package.update_receipt_invalid");
    if (["rollback_prepared", "rolled_back"].includes(String(receipt.state))) {
      if (typeof receipt.rollbackRequestId !== "string" || !ROLLBACK_REQUEST_PATTERN.test(receipt.rollbackRequestId) ||
        !Number.isSafeInteger(receipt.rollbackExpectedRegistryRevision) ||
        receipt.rollbackExpectedRegistryRevision! < receipt.committedRegistryRevision!) {
        throw lifecycleError("package.update_receipt_invalid");
      }
    } else if (receipt.rollbackRequestId !== undefined || receipt.rollbackExpectedRegistryRevision !== undefined) {
      throw lifecycleError("package.update_receipt_invalid");
    }
    if (receipt.state === "rolled_back") {
      if (!Number.isSafeInteger(receipt.rolledBackRegistryRevision) || receipt.rolledBackRegistryRevision! < 1) {
        throw lifecycleError("package.update_receipt_invalid");
      }
      if (receipt.rolledBackRegistryRevision !== receipt.rollbackExpectedRegistryRevision! + 1) {
        throw lifecycleError("package.update_receipt_invalid");
      }
    } else if (receipt.rolledBackRegistryRevision !== undefined) throw lifecycleError("package.update_receipt_invalid");
    return { ...receipt, previousRecord, nextRecord } as PiPackageUpdateReceipt<T>;
  }

  #parseRestoreReceipt(value: unknown, uninstallRequestId: string): PiPackageRestoreReceipt<T> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw lifecycleError("package.restore_receipt_invalid");
    const receipt = value as Partial<PiPackageRestoreReceipt<T>>;
    const record = this.#parseRecord(receipt.record);
    const expectedKeys = receipt.state === "committed"
      ? "committedRegistryRevision,createdAt,expectedRegistryRevision,packageId,record,requestId,restoreContextId,schemaVersion,state,uninstallReceiptHash,uninstallRequestId"
      : "createdAt,expectedRegistryRevision,packageId,record,requestId,restoreContextId,schemaVersion,state,uninstallReceiptHash,uninstallRequestId";
    if (Object.keys(value).sort().join(",") !== expectedKeys || receipt.schemaVersion !== 1 ||
      (receipt.state !== "prepared" && receipt.state !== "committed") ||
      typeof receipt.requestId !== "string" || !RESTORE_REQUEST_PATTERN.test(receipt.requestId) ||
      typeof receipt.restoreContextId !== "string" || !RESTORE_CONTEXT_PATTERN.test(receipt.restoreContextId) ||
      receipt.uninstallRequestId !== uninstallRequestId || receipt.packageId !== record.packageId ||
      !Number.isSafeInteger(receipt.expectedRegistryRevision) || receipt.expectedRegistryRevision! < 0 ||
      typeof receipt.uninstallReceiptHash !== "string" || !SHA256_PATTERN.test(receipt.uninstallReceiptHash) ||
      typeof receipt.createdAt !== "string" || Number.isNaN(Date.parse(receipt.createdAt)) ||
      (receipt.state === "prepared" && receipt.committedRegistryRevision !== undefined) ||
      (receipt.state === "committed" && receipt.committedRegistryRevision !== receipt.expectedRegistryRevision! + 1)) {
      throw lifecycleError("package.restore_receipt_invalid");
    }
    return { ...receipt, record } as PiPackageRestoreReceipt<T>;
  }
}

export function hashPiPackageTree(root: string): string {
  const digest = createHash("sha256");
  hashTree(root, root, digest);
  return `sha256:${digest.digest("hex")}`;
}

function assertTreeHash(root: string, expected: string): void {
  if (hashPiPackageTree(root) !== expected) throw lifecycleError("package.install_changed");
}

function hashTree(root: string, directory: string, digest: ReturnType<typeof createHash>): void {
  for (const entry of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right, "en"))) {
    if (entry === OWNER_MARKER && directory === root) continue;
    const candidate = path.join(directory, entry);
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory()) || (stats.isFile() && stats.nlink !== 1)) {
      throw lifecycleError("package.install_changed");
    }
    const relative = path.relative(root, candidate).split(path.sep).join("/");
    digest.update(stats.isDirectory() ? "d\0" : "f\0").update(relative).update("\0");
    if (stats.isDirectory()) hashTree(root, candidate, digest);
    else digest.update(readRegularFile(candidate, stats)).update("\0");
  }
}

function readRegularFile(filePath: string, expected: fs.Stats): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.nlink !== 1) {
      throw lifecycleError("package.install_changed");
    }
    const body = fs.readFileSync(descriptor);
    const completed = fs.fstatSync(descriptor);
    if (completed.dev !== opened.dev || completed.ino !== opened.ino || completed.size !== opened.size || body.byteLength !== opened.size) {
      throw lifecycleError("package.install_changed");
    }
    return body;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertDirectory(root: string, candidate: string): void {
  ensureConfined(root, candidate);
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stats = fs.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw lifecycleError("package.install_changed");
  }
  if (fs.realpathSync.native(candidate) !== path.resolve(candidate)) throw lifecycleError("package.install_changed");
}

function readBoundedNoFollow(filePath: string, maxBytes: number): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size > maxBytes || stats.nlink !== 1) throw lifecycleError("package.uninstall_receipt_invalid");
    return fs.readFileSync(descriptor, "utf8");
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writePrivateJson(filePath: string, value: unknown): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try { writePrivateJson(temporary, value); fs.renameSync(temporary, filePath); fsyncDirectory(path.dirname(filePath)); }
  finally { fs.rmSync(temporary, { force: true }); }
}

function ensureConfined(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw lifecycleError("package.install_changed");
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function sameIntent<T extends PiPackageLifecycleRecord>(
  left: PiPackageUninstallReceipt<T>,
  right: PiPackageUninstallReceipt<T>
): boolean {
  return left.requestId === right.requestId && left.packageId === right.packageId &&
    left.expectedRegistryRevision === right.expectedRegistryRevision && JSON.stringify(left.record) === JSON.stringify(right.record);
}

function sameUpdateIntent<T extends PiPackageLifecycleRecord>(
  left: PiPackageUpdateReceipt<T>,
  right: PiPackageUpdateReceipt<T>
): boolean {
  return left.requestId === right.requestId && left.rollbackId === right.rollbackId &&
    left.packageId === right.packageId && left.expectedRegistryRevision === right.expectedRegistryRevision &&
    sameLifecycleRecord(left.previousRecord, right.previousRecord) &&
    sameLifecycleRecord(left.nextRecord, right.nextRecord);
}

function sameRestoreIntent<T extends PiPackageLifecycleRecord>(
  left: PiPackageRestoreReceipt<T>,
  right: PiPackageRestoreReceipt<T>
): boolean {
  return left.requestId === right.requestId && left.restoreContextId === right.restoreContextId &&
    left.packageId === right.packageId && left.expectedRegistryRevision === right.expectedRegistryRevision &&
    left.uninstallRequestId === right.uninstallRequestId && left.uninstallReceiptHash === right.uninstallReceiptHash &&
    sameLifecycleRecord(left.record, right.record);
}

export function hashPiPackageUninstallReceipt<T extends PiPackageLifecycleRecord>(receipt: PiPackageUninstallReceipt<T>): string {
  return `sha256:${createHash("sha256").update(stableJson(receipt), "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  throw lifecycleError("package.restore_receipt_invalid");
}

function sameLifecycleRecord(left: PiPackageLifecycleRecord, right: PiPackageLifecycleRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameLifecycleRecordIgnoringPin(left: PiPackageLifecycleRecord, right: PiPackageLifecycleRecord): boolean {
  const { pinned: _leftPinned, ...leftUnpinned } = left as PiPackageLifecycleRecord & { readonly pinned?: true };
  const { pinned: _rightPinned, ...rightUnpinned } = right as PiPackageLifecycleRecord & { readonly pinned?: true };
  return JSON.stringify(leftUnpinned) === JSON.stringify(rightUnpinned);
}

function assertRequestId(value: string): void {
  if (!REQUEST_PATTERN.test(value)) throw lifecycleError("package.uninstall_receipt_invalid");
}

function assertUpdateRequestId(value: string): void {
  if (!UPDATE_REQUEST_PATTERN.test(value)) throw lifecycleError("package.update_receipt_invalid");
}

function assertRollbackRequestId(value: string): void {
  if (!ROLLBACK_REQUEST_PATTERN.test(value)) throw lifecycleError("package.rollback_receipt_invalid");
}

function assertRollbackId(value: string): void {
  if (!ROLLBACK_ID_PATTERN.test(value)) throw lifecycleError("package.update_receipt_invalid");
}

function assertRestoreRequestId(value: string): void {
  if (!RESTORE_REQUEST_PATTERN.test(value)) throw lifecycleError("package.restore_receipt_invalid");
}

function isErrno(value: unknown, code: string): boolean {
  return !!value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === code;
}

function lifecycleError(code: string): PigeDomainError {
  return new PigeDomainError(code, "Pi package lifecycle state is unavailable or changed.");
}
