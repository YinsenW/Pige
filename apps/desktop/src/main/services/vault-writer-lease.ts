import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import lockfile from "proper-lockfile";

export const VAULT_WRITER_LOCK_DIRECTORY_NAME = "vault-writer.lock";
export const VAULT_WRITER_OWNER_RECORD_NAME = "vault-writer.owner.json";

export const VAULT_WRITER_LEASE_DEFAULT_TIMING = Object.freeze({
  staleMs: 30_000,
  updateMs: 10_000
});

export interface VaultWriterLeaseTiming {
  readonly staleMs: number;
  readonly updateMs: number;
}

export interface VaultWriterLeaseOptions {
  readonly timing?: VaultWriterLeaseTiming;
  readonly testOnlyHooks?: {
    readonly beforeLockDirectoryRemoval?: () => void;
    readonly beforeObservedStaleRemoval?: () => void;
    readonly beforeObservedStaleCommit?: () => void;
  };
}

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface LockSentinelIdentity extends FileIdentity {
  readonly name: string;
}

interface LeaseState {
  status: "active" | "invalid" | "released";
}

interface OwnerRecord {
  readonly schemaVersion: 1;
  readonly token: string;
}

const OWNER_RECORD_MAX_BYTES = 256;
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCK_SENTINEL_PREFIX = ".pige-owner-";

interface FencedLockFs {
  readonly fs: typeof fs;
  markOwnerReady(): void;
  requireOwnedIdentity(): FileIdentity;
  requireOwnedSentinelIdentity(): LockSentinelIdentity;
}

type MutableFs = { -readonly [Key in keyof typeof fs]: (typeof fs)[Key] };

export class VaultWriterLease {
  readonly vaultPath: string;
  readonly runtimePath: string;

  readonly #lockDirectoryPath: string;
  readonly #ownerRecordPath: string;
  readonly #vaultIdentity: FileIdentity;
  readonly #runtimeIdentity: FileIdentity;
  readonly #lockDirectoryIdentity: FileIdentity;
  readonly #lockSentinelIdentity: LockSentinelIdentity;
  readonly #ownerToken: string;
  readonly #libraryRelease: () => void;
  readonly #state: LeaseState;

  private constructor(input: {
    vaultPath: string;
    runtimePath: string;
    lockDirectoryPath: string;
    ownerRecordPath: string;
    vaultIdentity: FileIdentity;
    runtimeIdentity: FileIdentity;
    lockDirectoryIdentity: FileIdentity;
    lockSentinelIdentity: LockSentinelIdentity;
    ownerToken: string;
    libraryRelease: () => void;
    state: LeaseState;
  }) {
    this.vaultPath = input.vaultPath;
    this.runtimePath = input.runtimePath;
    this.#lockDirectoryPath = input.lockDirectoryPath;
    this.#ownerRecordPath = input.ownerRecordPath;
    this.#vaultIdentity = input.vaultIdentity;
    this.#runtimeIdentity = input.runtimeIdentity;
    this.#lockDirectoryIdentity = input.lockDirectoryIdentity;
    this.#lockSentinelIdentity = input.lockSentinelIdentity;
    this.#ownerToken = input.ownerToken;
    this.#libraryRelease = input.libraryRelease;
    this.#state = input.state;
  }

  static acquire(vaultPath: string, options: VaultWriterLeaseOptions = {}): VaultWriterLease {
    const timing = parseTiming(options.timing);
    let libraryRelease: (() => void) | undefined;
    let lockDirectoryPath: string | undefined;
    let lockDirectoryIdentity: FileIdentity | undefined;
    let lockSentinelIdentity: LockSentinelIdentity | undefined;
    let ownerRecordPath: string | undefined;
    let ownerToken: string | undefined;
    let fencedLockFs: FencedLockFs | undefined;
    const state: LeaseState = { status: "active" };

    try {
      const vault = captureCanonicalDirectory(vaultPath);
      const runtime = prepareRuntimeDirectory(vault.path, vault.identity);
      lockDirectoryPath = path.join(runtime.path, VAULT_WRITER_LOCK_DIRECTORY_NAME);
      ownerRecordPath = path.join(runtime.path, VAULT_WRITER_OWNER_RECORD_NAME);
      ownerToken = randomBytes(32).toString("base64url");
      fencedLockFs = createFencedLockFs(
        lockDirectoryPath,
        ownerRecordPath,
        ownerToken,
        timing.staleMs,
        options.testOnlyHooks?.beforeLockDirectoryRemoval,
        options.testOnlyHooks?.beforeObservedStaleRemoval,
        options.testOnlyHooks?.beforeObservedStaleCommit
      );

      try {
        libraryRelease = lockfile.lockSync(runtime.path, {
          fs: fencedLockFs.fs,
          lockfilePath: lockDirectoryPath,
          onCompromised: () => {
            if (state.status === "active") state.status = "invalid";
          },
          realpath: false,
          retries: 0,
          stale: timing.staleMs,
          update: timing.updateMs
        });
      } catch (caught) {
        if (isErrno(caught, "ELOCKED")) throw writerLocked();
        throw writerLeaseInvalid();
      }

      lockDirectoryIdentity = fencedLockFs.requireOwnedIdentity();
      lockSentinelIdentity = fencedLockFs.requireOwnedSentinelIdentity();
      assertDirectoryStillMatches(vault.path, vault.identity);
      assertDirectoryStillMatches(runtime.path, runtime.identity);

      writeOwnerRecordAtomic(runtime.path, runtime.identity, lockDirectoryPath, lockDirectoryIdentity, ownerRecordPath, {
        schemaVersion: 1,
        token: ownerToken
      });
      fencedLockFs.markOwnerReady();

      const lease = new VaultWriterLease({
        vaultPath: vault.path,
        runtimePath: runtime.path,
        lockDirectoryPath,
        ownerRecordPath,
        vaultIdentity: vault.identity,
        runtimeIdentity: runtime.identity,
        lockDirectoryIdentity,
        lockSentinelIdentity,
        ownerToken,
        libraryRelease,
        state
      });
      lease.assertHeld();
      return lease;
    } catch (caught) {
      state.status = "invalid";
      if (libraryRelease && lockDirectoryPath && lockDirectoryIdentity) {
        releaseAfterFailedAcquire(
          libraryRelease,
          lockDirectoryPath,
          lockDirectoryIdentity,
          ownerRecordPath,
          ownerToken
        );
      }
      if (caught instanceof PigeDomainError && caught.code === "vault.writer_locked") throw caught;
      throw writerLeaseInvalid();
    }
  }

  static acquireSync(vaultPath: string, options: VaultWriterLeaseOptions = {}): VaultWriterLease {
    return VaultWriterLease.acquire(vaultPath, options);
  }

  assertHeld(): void {
    if (this.#state.status !== "active") throw writerLeaseLost();

    try {
      assertDirectoryStillMatches(this.vaultPath, this.#vaultIdentity);
      assertDirectoryStillMatches(this.runtimePath, this.#runtimeIdentity);
      assertDirectoryStillMatches(this.#lockDirectoryPath, this.#lockDirectoryIdentity);
      assertExactLockSentinel(
        this.#lockDirectoryPath,
        `${LOCK_SENTINEL_PREFIX}${this.#ownerToken}`,
        this.#lockSentinelIdentity
      );
      if (!ownerRecordMatches(this.#ownerRecordPath, this.#ownerToken)) throw writerLeaseLost();
    } catch {
      this.#state.status = "invalid";
      throw writerLeaseLost();
    }
  }

  release(): void {
    if (this.#state.status === "released") return;
    this.assertHeld();

    try {
      this.#libraryRelease();
    } catch {
      this.#state.status = "invalid";
      throw writerLeaseLost();
    }

    this.#state.status = "released";
    removeOwnerRecordIfStillOurs(this.#ownerRecordPath, this.#ownerToken);
  }

  releaseSync(): void {
    this.release();
  }
}

export function acquireVaultWriterLease(
  vaultPath: string,
  options: VaultWriterLeaseOptions = {}
): VaultWriterLease {
  return VaultWriterLease.acquire(vaultPath, options);
}

export function acquireVaultWriterLeaseSync(
  vaultPath: string,
  options: VaultWriterLeaseOptions = {}
): VaultWriterLease {
  return VaultWriterLease.acquireSync(vaultPath, options);
}

function createFencedLockFs(
  lockDirectoryPath: string,
  ownerRecordPath: string,
  ownerToken: string,
  staleMs: number,
  beforeLockDirectoryRemoval: (() => void) | undefined,
  beforeObservedStaleRemoval: (() => void) | undefined,
  beforeObservedStaleCommit: (() => void) | undefined
): FencedLockFs {
  const resolvedLockPath = path.resolve(lockDirectoryPath);
  const sentinelName = `${LOCK_SENTINEL_PREFIX}${ownerToken}`;
  const sentinelPath = path.join(resolvedLockPath, sentinelName);
  let ownedIdentity: FileIdentity | undefined;
  let ownedSentinelIdentity: LockSentinelIdentity | undefined;
  let observedIdentity: FileIdentity | undefined;
  let observedSentinelIdentity: LockSentinelIdentity | undefined;
  let observedMtimeMs: number | undefined;
  let ownerReady = false;
  const fencedFs = { ...fs } as MutableFs;

  fencedFs.mkdirSync = ((targetPath: fs.PathLike, options?: fs.MakeDirectoryOptions | number) => {
    const result = fs.mkdirSync(targetPath, options as fs.MakeDirectoryOptions);
    if (!sameResolvedPath(targetPath, resolvedLockPath)) return result;

    try {
      ownedIdentity = captureExpectedDirectory(resolvedLockPath).identity;
      ownedSentinelIdentity = writeLockSentinel(sentinelPath, sentinelName);
      observedIdentity = ownedIdentity;
      observedSentinelIdentity = ownedSentinelIdentity;
      return result;
    } catch (caught) {
      // Without the unique sentinel, no later path-based removal can prove that
      // the directory is still ours. Leave it for fenced stale-lock recovery.
      throw caught;
    }
  }) as typeof fs.mkdirSync;

  fencedFs.statSync = ((targetPath: fs.PathLike, options?: fs.StatOptions) => {
    const result = fs.statSync(targetPath, options as fs.StatOptions & { bigint?: false });
    if (sameResolvedPath(targetPath, resolvedLockPath) && result instanceof fs.Stats) {
      const current = captureExpectedDirectory(resolvedLockPath);
      observedIdentity = current.identity;
      const currentSentinelName = readSingleLockSentinelName(resolvedLockPath);
      observedSentinelIdentity = currentSentinelName
        ? captureExactLockSentinel(resolvedLockPath, currentSentinelName)
        : undefined;
      observedMtimeMs = result.mtime.getTime();
    }
    return result;
  }) as typeof fs.statSync;

  fencedFs.utimesSync = ((targetPath: fs.PathLike, atime: string | number | Date, mtime: string | number | Date) => {
    if (sameResolvedPath(targetPath, resolvedLockPath) && ownedIdentity) {
      if (!ownedSentinelIdentity) throw fencedRemovalError();
      assertOwnedLockDirectory(resolvedLockPath, ownedIdentity, ownedSentinelIdentity);
    }
    return fs.utimesSync(targetPath, atime, mtime);
  }) as typeof fs.utimesSync;

  fencedFs.rmdirSync = ((targetPath: fs.PathLike, options?: fs.RmDirOptions) => {
    if (!sameResolvedPath(targetPath, resolvedLockPath)) {
      return fs.rmdirSync(targetPath, options);
    }

    const expectedIdentity = ownedIdentity ?? observedIdentity;
    if (!expectedIdentity) throw fencedRemovalError();

    if (ownedIdentity) {
      if (!ownedSentinelIdentity) throw fencedRemovalError();
      const current = captureExpectedDirectory(resolvedLockPath);
      if (!sameIdentity(current.identity, expectedIdentity)) throw fencedRemovalError();
      if (ownerReady && !ownerRecordMatches(ownerRecordPath, ownerToken)) throw fencedRemovalError();
      removeExactLockSentinel(resolvedLockPath, sentinelName, ownedSentinelIdentity);
    } else {
      beforeObservedStaleRemoval?.();
      assertObservedStaleLock(
        resolvedLockPath,
        expectedIdentity,
        observedMtimeMs,
        observedSentinelIdentity,
        staleMs
      );
      beforeObservedStaleCommit?.();
      assertObservedStaleLock(
        resolvedLockPath,
        expectedIdentity,
        observedMtimeMs,
        observedSentinelIdentity,
        staleMs
      );
      if (observedSentinelIdentity) {
        removeExactLockSentinel(
          resolvedLockPath,
          observedSentinelIdentity.name,
          observedSentinelIdentity
        );
      }
    }

    if (ownedIdentity) beforeLockDirectoryRemoval?.();
    const result = fs.rmdirSync(targetPath, options);
    if (ownedIdentity && ownerReady) removeOwnerRecordIfStillOurs(ownerRecordPath, ownerToken);
    return result;
  }) as typeof fs.rmdirSync;

  return {
    fs: fencedFs as typeof fs,
    markOwnerReady: () => {
      if (
        !ownedIdentity ||
        !ownedSentinelIdentity ||
        !ownerRecordMatches(ownerRecordPath, ownerToken)
      ) {
        throw writerLeaseInvalid();
      }
      ownerReady = true;
    },
    requireOwnedIdentity: () => {
      if (!ownedIdentity) throw writerLeaseInvalid();
      if (!ownedSentinelIdentity) throw writerLeaseInvalid();
      assertOwnedLockDirectory(resolvedLockPath, ownedIdentity, ownedSentinelIdentity);
      return ownedIdentity;
    },
    requireOwnedSentinelIdentity: () => {
      if (!ownedIdentity || !ownedSentinelIdentity) throw writerLeaseInvalid();
      assertOwnedLockDirectory(resolvedLockPath, ownedIdentity, ownedSentinelIdentity);
      return ownedSentinelIdentity;
    }
  };
}

function sameResolvedPath(candidate: fs.PathLike, expected: string): boolean {
  return typeof candidate === "string" && path.resolve(candidate) === expected;
}

function writeLockSentinel(sentinelPath: string, sentinelName: string): LockSentinelIdentity {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      sentinelPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollowFlag(),
      0o600
    );
    fs.writeFileSync(descriptor, "pige-lock-v1\n", "utf8");
    fs.fsyncSync(descriptor);
    if (process.platform !== "win32") fs.fchmodSync(descriptor, 0o600);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) throw writerLeaseInvalid();
    fs.closeSync(descriptor);
    descriptor = undefined;
    flushDirectoryWhereSupported(path.dirname(sentinelPath));
    return { name: sentinelName, dev: stat.dev, ino: stat.ino };
  } catch {
    throw writerLeaseInvalid();
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative sentinel failure.
      }
    }
  }
}

function readSingleLockSentinelName(lockDirectoryPath: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(lockDirectoryPath);
  } catch {
    throw fencedRemovalError();
  }
  if (entries.length === 0) return undefined;
  if (
    entries.length !== 1 ||
    !entries[0]?.startsWith(LOCK_SENTINEL_PREFIX) ||
    !OWNER_TOKEN_PATTERN.test(entries[0].slice(LOCK_SENTINEL_PREFIX.length))
  ) {
    throw fencedRemovalError();
  }
  return entries[0];
}

function captureExactLockSentinel(
  lockDirectoryPath: string,
  expectedName: string
): LockSentinelIdentity {
  if (readSingleLockSentinelName(lockDirectoryPath) !== expectedName) throw fencedRemovalError();
  const sentinelPath = path.join(lockDirectoryPath, expectedName);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(sentinelPath);
  } catch {
    throw fencedRemovalError();
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
  ) {
    throw fencedRemovalError();
  }
  return { name: expectedName, dev: stat.dev, ino: stat.ino };
}

function assertExactLockSentinel(
  lockDirectoryPath: string,
  expectedName: string,
  expectedIdentity: LockSentinelIdentity
): void {
  const current = captureExactLockSentinel(lockDirectoryPath, expectedName);
  if (!sameLockSentinelIdentity(current, expectedIdentity)) throw fencedRemovalError();
}

function assertOwnedLockDirectory(
  lockDirectoryPath: string,
  expectedIdentity: FileIdentity,
  sentinelIdentity: LockSentinelIdentity
): void {
  const current = captureExpectedDirectory(lockDirectoryPath);
  if (!sameIdentity(current.identity, expectedIdentity)) throw fencedRemovalError();
  assertExactLockSentinel(lockDirectoryPath, sentinelIdentity.name, sentinelIdentity);
}

function removeExactLockSentinel(
  lockDirectoryPath: string,
  sentinelName: string,
  expectedIdentity: LockSentinelIdentity
): void {
  const sentinelPath = path.join(lockDirectoryPath, sentinelName);
  try {
    assertExactLockSentinel(lockDirectoryPath, sentinelName, expectedIdentity);
    fs.unlinkSync(sentinelPath);
    flushDirectoryWhereSupported(lockDirectoryPath);
  } catch {
    throw fencedRemovalError();
  }
}

function assertObservedStaleLock(
  lockDirectoryPath: string,
  expectedDirectoryIdentity: FileIdentity,
  observedMtimeMs: number | undefined,
  observedSentinelIdentity: LockSentinelIdentity | undefined,
  staleMs: number
): void {
  const current = captureExpectedDirectory(lockDirectoryPath);
  const currentMtimeMs = current.stat.mtime.getTime();
  if (
    !sameIdentity(current.identity, expectedDirectoryIdentity) ||
    observedMtimeMs === undefined ||
    currentMtimeMs !== observedMtimeMs ||
    currentMtimeMs >= Date.now() - staleMs
  ) {
    throw fencedRemovalError();
  }
  const currentSentinelName = readSingleLockSentinelName(lockDirectoryPath);
  if (!observedSentinelIdentity) {
    if (currentSentinelName !== undefined) throw fencedRemovalError();
    return;
  }
  if (currentSentinelName !== observedSentinelIdentity.name) throw fencedRemovalError();
  const currentSentinelIdentity = captureExactLockSentinel(
    lockDirectoryPath,
    observedSentinelIdentity.name
  );
  if (!sameLockSentinelIdentity(currentSentinelIdentity, observedSentinelIdentity)) {
    throw fencedRemovalError();
  }
}

function fencedRemovalError(): NodeJS.ErrnoException {
  return Object.assign(new Error("The vault lock ownership changed before release."), {
    code: "EPERM"
  });
}

function parseTiming(timing: VaultWriterLeaseTiming | undefined): VaultWriterLeaseTiming {
  const resolved = timing ?? VAULT_WRITER_LEASE_DEFAULT_TIMING;
  if (
    !Number.isSafeInteger(resolved.staleMs) ||
    !Number.isSafeInteger(resolved.updateMs) ||
    resolved.staleMs < 2_000 ||
    resolved.updateMs < 1_000 ||
    resolved.updateMs > resolved.staleMs / 2
  ) {
    throw writerLeaseInvalid();
  }
  return resolved;
}

function captureCanonicalDirectory(directoryPath: string): { path: string; identity: FileIdentity } {
  if (typeof directoryPath !== "string" || directoryPath.trim() === "") throw writerLeaseInvalid();
  const resolvedPath = path.resolve(directoryPath);
  const requested = lstatDirectory(resolvedPath);
  const canonicalPath = safeRealpath(resolvedPath);
  const canonical = lstatDirectory(canonicalPath);
  if (!sameIdentity(identityOf(requested), identityOf(canonical))) throw writerLeaseInvalid();
  return { path: canonicalPath, identity: identityOf(canonical) };
}

function prepareRuntimeDirectory(vaultPath: string, vaultIdentity: FileIdentity): {
  path: string;
  identity: FileIdentity;
} {
  assertDirectoryStillMatches(vaultPath, vaultIdentity);
  const pigePath = path.join(vaultPath, ".pige");
  const pige = captureExpectedDirectory(pigePath);
  assertContainedRealPath(vaultPath, pige.path);

  const runtimePath = path.join(pige.path, "runtime");
  try {
    fs.mkdirSync(runtimePath, { mode: 0o700 });
    flushDirectoryWhereSupported(pige.path);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw writerLeaseInvalid();
  }

  assertDirectoryStillMatches(vaultPath, vaultIdentity);
  assertDirectoryStillMatches(pige.path, pige.identity);
  const runtime = captureExpectedDirectory(runtimePath);
  assertContainedRealPath(vaultPath, runtime.path);
  return runtime;
}

function captureExpectedDirectory(directoryPath: string): {
  path: string;
  identity: FileIdentity;
  stat: fs.Stats;
} {
  const resolvedPath = path.resolve(directoryPath);
  const stat = lstatDirectory(resolvedPath);
  const canonicalPath = safeRealpath(resolvedPath);
  if (canonicalPath !== resolvedPath) throw writerLeaseInvalid();
  const canonical = lstatDirectory(canonicalPath);
  if (!sameIdentity(identityOf(stat), identityOf(canonical))) throw writerLeaseInvalid();
  return { path: canonicalPath, identity: identityOf(canonical), stat: canonical };
}

function assertDirectoryStillMatches(directoryPath: string, expected: FileIdentity): void {
  const stat = lstatDirectory(directoryPath);
  if (!sameIdentity(identityOf(stat), expected) || safeRealpath(directoryPath) !== directoryPath) {
    throw writerLeaseLost();
  }
}

function lstatDirectory(directoryPath: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch {
    throw writerLeaseInvalid();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw writerLeaseInvalid();
  return stat;
}

function safeRealpath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    throw writerLeaseInvalid();
  }
}

function assertContainedRealPath(vaultPath: string, targetPath: string): void {
  if (targetPath === vaultPath || !targetPath.startsWith(`${vaultPath}${path.sep}`)) {
    throw writerLeaseInvalid();
  }
}

function identityOf(stat: fs.Stats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameLockSentinelIdentity(
  left: LockSentinelIdentity,
  right: LockSentinelIdentity
): boolean {
  return left.name === right.name && sameIdentity(left, right);
}

function writeOwnerRecordAtomic(
  runtimePath: string,
  runtimeIdentity: FileIdentity,
  lockDirectoryPath: string,
  lockDirectoryIdentity: FileIdentity,
  ownerRecordPath: string,
  record: OwnerRecord
): void {
  const temporaryPath = path.join(
    runtimePath,
    `.${VAULT_WRITER_OWNER_RECORD_NAME}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
  let descriptor: number | undefined;

  try {
    assertDirectoryStillMatches(runtimePath, runtimeIdentity);
    assertDirectoryStillMatches(lockDirectoryPath, lockDirectoryIdentity);
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollowFlag(),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.fchmodSync(descriptor, 0o600);
    fs.closeSync(descriptor);
    descriptor = undefined;

    assertDirectoryStillMatches(runtimePath, runtimeIdentity);
    assertDirectoryStillMatches(lockDirectoryPath, lockDirectoryIdentity);
    fs.renameSync(temporaryPath, ownerRecordPath);
    flushDirectoryWhereSupported(runtimePath);
    assertDirectoryStillMatches(runtimePath, runtimeIdentity);
    assertDirectoryStillMatches(lockDirectoryPath, lockDirectoryIdentity);
    if (!ownerRecordMatches(ownerRecordPath, record.token)) throw writerLeaseInvalid();
  } catch {
    throw writerLeaseInvalid();
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative lease result.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // A stale private temporary file is not lease authority.
    }
  }
}

function ownerRecordMatches(ownerRecordPath: string, expectedToken: string): boolean {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(ownerRecordPath, fs.constants.O_RDONLY | noFollowFlag());
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size <= 0 ||
      before.size > OWNER_RECORD_MAX_BYTES ||
      (process.platform !== "win32" && (before.mode & 0o777) !== 0o600)
    ) {
      return false;
    }

    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) return false;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (
      !sameIdentity(identityOf(before), identityOf(after)) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      return false;
    }

    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    return isExactOwnerRecord(parsed) && parsed.token === expectedToken;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The completed read result remains authoritative.
      }
    }
  }
}

function isExactOwnerRecord(value: unknown): value is OwnerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.schemaVersion === 1 &&
    typeof record.token === "string" &&
    OWNER_TOKEN_PATTERN.test(record.token)
  );
}

function releaseAfterFailedAcquire(
  libraryRelease: () => void,
  lockDirectoryPath: string,
  lockDirectoryIdentity: FileIdentity,
  ownerRecordPath: string | undefined,
  ownerToken: string | undefined
): void {
  if (!directoryIdentityMatches(lockDirectoryPath, lockDirectoryIdentity)) return;
  try {
    libraryRelease();
  } catch {
    return;
  }
  if (ownerRecordPath && ownerToken) removeOwnerRecordIfStillOurs(ownerRecordPath, ownerToken);
}

function directoryIdentityMatches(directoryPath: string, expected: FileIdentity): boolean {
  try {
    const stat = fs.lstatSync(directoryPath);
    return stat.isDirectory() && !stat.isSymbolicLink() && sameIdentity(identityOf(stat), expected);
  } catch {
    return false;
  }
}

function removeOwnerRecordIfStillOurs(ownerRecordPath: string, ownerToken: string): void {
  if (!ownerRecordMatches(ownerRecordPath, ownerToken)) return;
  try {
    fs.unlinkSync(ownerRecordPath);
    flushDirectoryWhereSupported(path.dirname(ownerRecordPath));
  } catch {
    // A sibling record is not lock authority and a later owner replaces it atomically.
  }
}

function flushDirectoryWhereSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isUnsupportedDirectoryFlush(caught)) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isUnsupportedDirectoryFlush(value: unknown): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  if (new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]).has(code)) return true;
  return process.platform === "win32" && new Set(["EACCES", "EISDIR", "EPERM"]).has(code);
}

function noFollowFlag(): number {
  return typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
}

function isErrno(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && String(value.code) === code;
}

function writerLocked(): PigeDomainError {
  return new PigeDomainError("vault.writer_locked", "Another Pige writer already owns this vault.");
}

function writerLeaseLost(): PigeDomainError {
  return new PigeDomainError("vault.writer_lease_lost", "The active vault writer lease is no longer held.");
}

function writerLeaseInvalid(): PigeDomainError {
  return new PigeDomainError("vault.writer_lease_invalid", "The vault writer lease could not be established safely.");
}
