import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const OWNER_MARKER = ".pige-package-owner.json";
const RECEIPT_NAME = ".pige-package-uninstall.json";
const MAX_RECEIPT_BYTES = 1024 * 1024;
const REQUEST_PATTERN = /^pi_package_uninstall_request_[a-z0-9]{16,64}$/u;
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

export interface PiPackageLifecycleStoreOptions<T extends PiPackageLifecycleRecord> {
  readonly packageRoot: string;
  readonly installedRoot: string;
  readonly parseRecord: (value: unknown) => T;
}

export class PiPackageLifecycleStore<T extends PiPackageLifecycleRecord> {
  readonly #packageRoot: string;
  readonly #installedRoot: string;
  readonly #trashRoot: string;
  readonly #parseRecord: (value: unknown) => T;

  constructor(options: PiPackageLifecycleStoreOptions<T>) {
    this.#packageRoot = options.packageRoot;
    this.#installedRoot = options.installedRoot;
    this.#trashRoot = path.join(options.packageRoot, "trash");
    this.#parseRecord = options.parseRecord;
    this.prepare();
  }

  prepare(): void {
    assertDirectory(this.#packageRoot, this.#installedRoot);
    if (!fs.existsSync(this.#trashRoot)) fs.mkdirSync(this.#trashRoot, { mode: 0o700 });
    assertDirectory(this.#packageRoot, this.#trashRoot);
    let removedTemporary = false;
    for (const entry of fs.readdirSync(this.#trashRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^pi_package_uninstall_request_[a-z0-9]{16,64}\.[0-9a-f-]{36}\.tmp$/u.test(entry.name)) continue;
      const temporary = path.join(this.#trashRoot, entry.name);
      assertDirectory(this.#trashRoot, temporary);
      fs.rmSync(temporary, { recursive: true });
      removedTemporary = true;
    }
    if (removedTemporary) fsyncDirectory(this.#trashRoot);
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

  #readMatchingReceipt(receipt: PiPackageUninstallReceipt<T>): PiPackageUninstallReceipt<T> {
    const current = this.readUninstallReceipt(receipt.requestId);
    if (!current || !sameIntent(current, receipt)) throw lifecycleError("package.uninstall_receipt_conflict");
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

function assertRequestId(value: string): void {
  if (!REQUEST_PATTERN.test(value)) throw lifecycleError("package.uninstall_receipt_invalid");
}

function isErrno(value: unknown, code: string): boolean {
  return !!value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === code;
}

function lifecycleError(code: string): PigeDomainError {
  return new PigeDomainError(code, "Pi package lifecycle state is unavailable or changed.");
}
