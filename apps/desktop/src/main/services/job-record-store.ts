import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import lockfile from "proper-lockfile";

const MAX_JOB_RECORD_BYTES = 2 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const JOB_CLAIM_OWNER_MAX_BYTES = 256;
const JOB_CLAIM_OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const JOB_CLAIM_OWNER_SENTINEL_PATTERN = /^\.owner-([A-Za-z0-9_-]{43})\.json$/u;

export const JOB_CLAIM_ROOT_DIRECTORY_NAME = "job-claims";
export const JOB_CLAIM_DEFAULT_TIMING = Object.freeze({
  staleMs: 30_000,
  updateMs: 10_000
});

export interface JobClaimTiming {
  readonly staleMs: number;
  readonly updateMs: number;
}

export interface JobRecordRevision {
  readonly sha256: `sha256:${string}`;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
}

export interface JobRecordSnapshot {
  readonly path: string;
  readonly job: JobRecord;
  readonly revision: JobRecordRevision;
}

interface JobRecordStoreCommonOptions {
  readonly rootPath: string;
  readonly claimTiming?: JobClaimTiming;
  readonly testOnlyHooks?: JobRecordStoreTestOnlyHooks;
}

interface JobRecordStoreTestOnlyHooks {
  readonly beforeClaimOwnerCommit?: () => void;
  readonly afterClaimOwnerOpen?: () => void;
  readonly beforeCreateLinkCommit?: () => void;
  readonly beforeCompareAndSwapRenameCommit?: () => void;
}

export type JobRecordStoreOptions = JobRecordStoreCommonOptions & (
  | {
      readonly assertWriterLease: () => void;
      readonly unsafeAllowUnfenced?: never;
    }
  | {
      readonly assertWriterLease?: never;
      readonly unsafeAllowUnfenced: true;
    }
);

interface DirectoryIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

interface FileReadResult {
  readonly bytes: Buffer;
  readonly stat: fs.Stats;
}

interface JobClaimState {
  status: "active" | "invalid" | "released";
}

interface JobClaimOwnerRecord {
  readonly schemaVersion: 1;
  readonly token: string;
}

interface JobClaimLockIdentity {
  readonly directory: DirectoryIdentity;
  readonly sentinelPath: string;
  readonly sentinelDev: number;
  readonly sentinelIno: number;
}

interface ObservedJobClaimLock {
  readonly directory: DirectoryIdentity;
  readonly mtimeMs: number;
  readonly stat: fs.Stats;
  readonly sentinel?: JobClaimLockIdentity;
  readonly recoverableEntry?: JobClaimFileIdentity;
}

interface JobClaimFileIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

interface JobClaimFileSystem {
  readonly fs: typeof fs;
  ownedLock(): JobClaimLockIdentity;
}

export interface JobRecordClaim {
  readonly path: string;
  assertHeld(): void;
  read(): JobRecordSnapshot;
  createIfAbsent(next: JobRecord): JobRecordSnapshot;
  compareAndSwap(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot;
  release(): void;
}

export interface NamedJobRecordClaim {
  assertHeld(): void;
  release(): void;
}

export class JobRecordStore {
  readonly #rootPath: string;
  readonly #claimRootPath: string;
  readonly #claimTiming: JobClaimTiming;
  readonly #assertWriterLease: (() => void) | undefined;
  readonly #testOnlyHooks: JobRecordStoreTestOnlyHooks;

  constructor(options: JobRecordStoreOptions) {
    if (!options || typeof options.rootPath !== "string" || options.rootPath.trim() === "") {
      throw new PigeDomainError("job.store_invalid", "The Job record root is invalid.");
    }
    if (
      options.assertWriterLease === undefined &&
      !("unsafeAllowUnfenced" in options && options.unsafeAllowUnfenced === true)
    ) {
      throw new PigeDomainError(
        "job.writer_lease_required",
        "A Job record store requires an explicit writer-lease assertion."
      );
    }
    this.#rootPath = path.resolve(options.rootPath);
    this.#claimRootPath = path.join(path.dirname(this.#rootPath), "runtime", JOB_CLAIM_ROOT_DIRECTORY_NAME);
    this.#claimTiming = parseClaimTiming(options.claimTiming);
    this.#assertWriterLease = options.assertWriterLease;
    this.#testOnlyHooks = options.testOnlyHooks ?? {};
  }

  read(filePath: string): JobRecordSnapshot {
    this.#assertLease();
    const resolvedPath = this.#resolveJobPath(filePath);
    const { bytes, stat } = readConfinedRegularFile(this.#rootPath, resolvedPath);
    let decoded: string;
    let job: JobRecord;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      job = JobRecordSchema.parse(JSON.parse(decoded));
    } catch {
      throw new PigeDomainError("job.record_invalid", "The Job record is not valid schema-v1 JSON.");
    }
    if (path.basename(resolvedPath) !== `${job.id}.json`) {
      throw new PigeDomainError("job.record_invalid", "The Job record identity does not match its path.");
    }
    return {
      path: resolvedPath,
      job,
      revision: revisionFor(bytes, stat)
    };
  }

  createIfAbsent(filePath: string, next: JobRecord): JobRecordSnapshot {
    const claim = this.acquireClaim(filePath);
    try {
      return claim.createIfAbsent(next);
    } finally {
      claim.release();
    }
  }

  compareAndSwap(snapshot: JobRecordSnapshot, next: JobRecord): JobRecordSnapshot {
    const claim = this.acquireClaim(snapshot.path);
    try {
      return claim.compareAndSwap(snapshot, next);
    } finally {
      claim.release();
    }
  }

  acquireClaim(filePath: string): JobRecordClaim {
    const resolvedPath = this.#resolveJobPath(filePath);
    this.#assertLease();
    const claimRootIdentity = prepareClaimRoot(this.#rootPath, this.#claimRootPath);
    const claimName = createHash("sha256")
      .update(`pige.job.claim.v1\0${path.relative(this.#rootPath, resolvedPath)}`, "utf8")
      .digest("hex");
    const lockDirectoryPath = path.join(this.#claimRootPath, `${claimName}.lock`);
    const lockKeyPath = path.join(this.#claimRootPath, `${claimName}.job`);
    const ownerToken = randomBytes(32).toString("base64url");
    const state: JobClaimState = { status: "active" };
    let libraryRelease: (() => void) | undefined;
    let lockIdentity: JobClaimLockIdentity | undefined;
    const claimFileSystem = createJobClaimFileSystem({
      claimRootPath: this.#claimRootPath,
      claimRootIdentity,
      lockDirectoryPath,
      ownerToken,
      timing: this.#claimTiming,
      ...(this.#testOnlyHooks.beforeClaimOwnerCommit
        ? { beforeOwnerCommit: this.#testOnlyHooks.beforeClaimOwnerCommit }
        : {}),
      ...(this.#testOnlyHooks.afterClaimOwnerOpen
        ? { afterOwnerOpen: this.#testOnlyHooks.afterClaimOwnerOpen }
        : {})
    });

    try {
      this.#assertLease();
      try {
        libraryRelease = lockfile.lockSync(lockKeyPath, {
          fs: claimFileSystem.fs,
          lockfilePath: lockDirectoryPath,
          onCompromised: () => {
            if (state.status === "active") state.status = "invalid";
          },
          realpath: false,
          retries: 0,
          stale: this.#claimTiming.staleMs,
          update: this.#claimTiming.updateMs
        });
      } catch (caught) {
        if (isErrno(caught, "ELOCKED")) throw jobClaimConflict();
        throw jobClaimInvalid();
      }
      lockIdentity = claimFileSystem.ownedLock();
      assertDirectoryChainMatches(claimRootIdentity, "job.claim_lost");
      if (!jobClaimOwnerMatches(lockIdentity, ownerToken)) throw jobClaimInvalid();
    } catch (caught) {
      state.status = "invalid";
      if (libraryRelease) {
        try {
          libraryRelease();
        } catch {
          // A failed acquisition cannot safely release a replacement lock.
        }
      }
      if (caught instanceof PigeDomainError) throw caught;
      throw jobClaimInvalid();
    }

    const assertClaim = (): void => {
      this.#assertLease();
      if (state.status !== "active" || !lockIdentity) throw jobClaimLost();
      try {
        assertDirectoryChainMatches(claimRootIdentity, "job.claim_lost");
        assertDirectoryIdentity(lockIdentity.directory, "job.claim_lost");
        if (!jobClaimOwnerMatches(lockIdentity, ownerToken)) throw jobClaimLost();
      } catch {
        state.status = "invalid";
        throw jobClaimLost();
      }
    };

    return {
      path: resolvedPath,
      assertHeld: assertClaim,
      read: () => {
        assertClaim();
        return this.read(resolvedPath);
      },
      createIfAbsent: (next) => this.#createIfAbsentClaimed(resolvedPath, next, assertClaim),
      compareAndSwap: (snapshot, next) => this.#compareAndSwapClaimed(resolvedPath, snapshot, next, assertClaim),
      release: () => {
        if (state.status === "released") return;
        assertClaim();
        try {
          libraryRelease?.();
        } catch {
          state.status = "invalid";
          throw jobClaimLost();
        }
        state.status = "released";
      }
    };
  }

  acquireNamedClaim(namespace: string, key: string): NamedJobRecordClaim {
    if (
      typeof namespace !== "string" ||
      !/^[a-z][a-z0-9_-]{2,63}$/u.test(namespace) ||
      typeof key !== "string" ||
      key.length === 0 ||
      Buffer.byteLength(key, "utf8") > 512
    ) {
      throw new PigeDomainError("job.claim_invalid", "The named Job claim identity is invalid.");
    }
    const keyHash = createHash("sha256")
      .update(`pige.job.named_claim.v1\0${namespace}\0${key}`, "utf8")
      .digest("hex");
    const claim = this.acquireClaim(path.join(this.#rootPath, `.named-${namespace}-${keyHash}.json`));
    return {
      assertHeld: claim.assertHeld,
      release: claim.release
    };
  }

  mutate(
    snapshot: JobRecordSnapshot,
    transform: (current: JobRecord) => JobRecord
  ): JobRecordSnapshot {
    return this.compareAndSwap(snapshot, transform(snapshot.job));
  }

  #createIfAbsentClaimed(
    resolvedPath: string,
    next: JobRecord,
    assertClaim: () => void
  ): JobRecordSnapshot {
    const parsedNext = parseNextJob(next);
    assertJobMatchesPath(resolvedPath, parsedNext);
    const bytes = serializeJob(parsedNext);
    assertClaim();
    const directoryIdentity = ensureSafeDirectoryChain(this.#rootPath, path.dirname(resolvedPath), true);
    const temporaryPath = writePrivateTemporaryFile(resolvedPath, bytes);
    let temporaryPresent = true;
    try {
      assertClaim();
      this.#testOnlyHooks.beforeCreateLinkCommit?.();
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      assertClaim();
      try {
        fs.linkSync(temporaryPath, resolvedPath);
      } catch (caught) {
        if (isErrno(caught, "EEXIST")) throw revisionConflict();
        throw caught;
      }
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      fs.unlinkSync(temporaryPath);
      temporaryPresent = false;
      flushDirectoryWhereSupported(path.dirname(resolvedPath));
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      return assertCommittedSnapshot(this.read(resolvedPath), bytes);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError("job.write_failed", "The Job record could not be created durably.");
    } finally {
      if (temporaryPresent) removeTemporaryFile(temporaryPath);
    }
  }

  #compareAndSwapClaimed(
    resolvedPath: string,
    snapshot: JobRecordSnapshot,
    next: JobRecord,
    assertClaim: () => void
  ): JobRecordSnapshot {
    const parsedNext = parseNextJob(next);
    assertSnapshotShape(snapshot, resolvedPath);
    assertJobMatchesPath(resolvedPath, parsedNext);
    if (parsedNext.id !== snapshot.job.id) throw revisionConflict();
    const bytes = serializeJob(parsedNext);
    assertClaim();
    const directoryIdentity = ensureSafeDirectoryChain(this.#rootPath, path.dirname(resolvedPath), false);
    const temporaryPath = writePrivateTemporaryFile(resolvedPath, bytes);
    try {
      assertClaim();
      const current = this.#readForCompare(resolvedPath);
      if (current.job.id !== snapshot.job.id || !sameRevision(current.revision, snapshot.revision)) {
        throw revisionConflict();
      }
      this.#testOnlyHooks.beforeCompareAndSwapRenameCommit?.();
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      assertClaim();
      fs.renameSync(temporaryPath, resolvedPath);
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      flushDirectoryWhereSupported(path.dirname(resolvedPath));
      assertDirectoryChainUnchanged(this.#rootPath, path.dirname(resolvedPath), directoryIdentity);
      return assertCommittedSnapshot(this.read(resolvedPath), bytes);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      if (isErrno(caught, "ENOENT") || isErrno(caught, "EEXIST")) throw revisionConflict();
      throw new PigeDomainError("job.write_failed", "The Job record could not be replaced durably.");
    } finally {
      removeTemporaryFile(temporaryPath);
    }
  }

  #readForCompare(filePath: string): JobRecordSnapshot {
    try {
      return this.read(filePath);
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw revisionConflict();
      throw caught;
    }
  }

  #assertLease(): void {
    if (!this.#assertWriterLease) return;
    try {
      this.#assertWriterLease();
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw new PigeDomainError("job.writer_lease_invalid", "The Job writer lease is not current.");
    }
  }

  #resolveJobPath(filePath: string): string {
    if (typeof filePath !== "string" || filePath.includes("\0")) {
      throw new PigeDomainError("job.path_unsafe", "The Job record path is invalid.");
    }
    const resolvedPath = path.resolve(filePath);
    const relative = path.relative(this.#rootPath, resolvedPath);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      path.extname(resolvedPath) !== ".json"
    ) {
      throw new PigeDomainError("job.path_unsafe", "The Job record path is outside its owned root.");
    }
    return resolvedPath;
  }
}

function parseClaimTiming(timing: JobClaimTiming | undefined): JobClaimTiming {
  const resolved = timing ?? JOB_CLAIM_DEFAULT_TIMING;
  if (
    !Number.isSafeInteger(resolved.staleMs) ||
    !Number.isSafeInteger(resolved.updateMs) ||
    resolved.staleMs < 2_000 ||
    resolved.updateMs < 1_000 ||
    resolved.updateMs > resolved.staleMs / 2
  ) {
    throw jobClaimInvalid();
  }
  return resolved;
}

function prepareClaimRoot(rootPath: string, claimRootPath: string): readonly DirectoryIdentity[] {
  const pigeRoot = path.dirname(rootPath);
  const expectedClaimRoot = path.join(pigeRoot, "runtime", JOB_CLAIM_ROOT_DIRECTORY_NAME);
  if (claimRootPath !== expectedClaimRoot) throw jobClaimInvalid();
  try {
    captureDirectoryIdentity(pigeRoot, "job.claim_invalid");
    captureDirectoryIdentity(rootPath, "job.claim_invalid");
    const runtimePath = path.dirname(claimRootPath);
    ensurePrivateDirectory(runtimePath);
    ensurePrivateDirectory(claimRootPath);
    const identities = ensureSafeDirectoryChain(pigeRoot, claimRootPath, false);
    assertDirectoryChainMatches(identities, "job.claim_invalid");
    return identities;
  } catch {
    throw jobClaimInvalid();
  }
}

function ensurePrivateDirectory(directoryPath: string): void {
  try {
    fs.mkdirSync(directoryPath, { mode: 0o700 });
    flushDirectoryWhereSupported(path.dirname(directoryPath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw jobClaimInvalid();
  }
  const identity = captureDirectoryIdentity(directoryPath, "job.claim_invalid");
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(directoryPath, 0o700);
    } catch {
      throw jobClaimInvalid();
    }
  }
  assertDirectoryIdentity(identity, "job.claim_invalid");
}

function captureDirectoryIdentity(directoryPath: string, code: string): DirectoryIdentity {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directoryPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe");
  } catch {
    throw new PigeDomainError(code, "The ephemeral Job claim path is unsafe.");
  }
  return { path: path.resolve(directoryPath), dev: stat.dev, ino: stat.ino };
}

function assertDirectoryIdentity(identity: DirectoryIdentity, code: string): void {
  const current = captureDirectoryIdentity(identity.path, code);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new PigeDomainError(code, "The ephemeral Job claim ownership changed.");
  }
}

function assertDirectoryChainMatches(expected: readonly DirectoryIdentity[], code: string): void {
  for (const identity of expected) assertDirectoryIdentity(identity, code);
}

function createJobClaimFileSystem(input: {
  readonly claimRootPath: string;
  readonly claimRootIdentity: readonly DirectoryIdentity[];
  readonly lockDirectoryPath: string;
  readonly ownerToken: string;
  readonly timing: JobClaimTiming;
  readonly beforeOwnerCommit?: () => void;
  readonly afterOwnerOpen?: () => void;
}): JobClaimFileSystem {
  const sentinelPath = path.join(
    input.lockDirectoryPath,
    `.owner-${input.ownerToken}.json`
  );
  let owned: JobClaimLockIdentity | undefined;
  let observed: ObservedJobClaimLock | undefined;

  const assertAdapterPath = (candidatePath: fs.PathLike): void => {
    if (typeof candidatePath !== "string" || path.resolve(candidatePath) !== input.lockDirectoryPath) {
      throw jobClaimInvalid();
    }
  };

  const claimFs = {
    ...fs,
    mkdirSync: (candidatePath: fs.PathLike): void => {
      assertAdapterPath(candidatePath);
      assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
      let directory: DirectoryIdentity | undefined;
      try {
        fs.mkdirSync(input.lockDirectoryPath, { mode: 0o700 });
        directory = captureDirectoryIdentity(input.lockDirectoryPath, "job.claim_invalid");
        input.beforeOwnerCommit?.();
        assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
        assertDirectoryIdentity(directory, "job.claim_invalid");
        owned = writeJobClaimSentinel(
          directory,
          sentinelPath,
          input.ownerToken,
          input.afterOwnerOpen
        );
        assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
        assertDirectoryIdentity(directory, "job.claim_invalid");
        if (!jobClaimOwnerMatches(owned, input.ownerToken)) throw jobClaimInvalid();
        flushDirectoryWhereSupported(input.lockDirectoryPath);
        flushDirectoryWhereSupported(input.claimRootPath);
        assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
      } catch (caught) {
        if (owned) removeOwnedJobClaimLock(input, owned);
        throw caught;
      }
    },
    statSync: (candidatePath: fs.PathLike): fs.Stats => {
      assertAdapterPath(candidatePath);
      assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_lost");
      const current = observeJobClaimLock(input.lockDirectoryPath);
      if (
        owned &&
        (!sameDirectoryIdentity(owned.directory, current.directory) ||
          !jobClaimOwnerMatches(owned, input.ownerToken))
      ) {
        throw errnoError("ENOENT", "The Job claim lock was replaced.");
      }
      observed = current;
      return current.stat;
    },
    utimesSync: (candidatePath: fs.PathLike, atime: string | number | Date, mtime: string | number | Date): void => {
      assertAdapterPath(candidatePath);
      if (!owned) throw errnoError("ENOENT", "The Job claim lock is not owned.");
      assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_lost");
      assertDirectoryIdentity(owned.directory, "job.claim_lost");
      if (!jobClaimOwnerMatches(owned, input.ownerToken)) {
        throw errnoError("ENOENT", "The Job claim owner changed.");
      }
      fs.utimesSync(input.lockDirectoryPath, atime, mtime);
      assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_lost");
      assertDirectoryIdentity(owned.directory, "job.claim_lost");
    },
    rmdirSync: (candidatePath: fs.PathLike): void => {
      assertAdapterPath(candidatePath);
      if (owned) {
        removeOwnedJobClaimLock(input, owned, true);
        return;
      }
      if (!observed) throw errnoError("ENOTEMPTY", "The stale Job claim was not observed.");
      removeObservedStaleJobClaimLock(input, observed);
    }
  } as unknown as typeof fs;

  return {
    fs: claimFs,
    ownedLock: () => {
      if (!owned) throw jobClaimInvalid();
      return owned;
    }
  };
}

function writeJobClaimSentinel(
  directory: DirectoryIdentity,
  sentinelPath: string,
  token: string,
  afterOwnerOpen: (() => void) | undefined
): JobClaimLockIdentity {
  const owner: JobClaimOwnerRecord = { schemaVersion: 1, token };
  const bytes = Buffer.from(`${JSON.stringify(owner)}\n`, "utf8");
  if (bytes.length > JOB_CLAIM_OWNER_MAX_BYTES || !JOB_CLAIM_OWNER_TOKEN_PATTERN.test(token)) {
    throw jobClaimInvalid();
  }
  let descriptor: number | undefined;
  let openedIdentity: JobClaimFileIdentity | undefined;
  try {
    descriptor = fs.openSync(
      sentinelPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      PRIVATE_FILE_MODE
    );
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.nlink !== 1) throw jobClaimInvalid();
    openedIdentity = { path: sentinelPath, dev: openedStat.dev, ino: openedStat.ino };
    afterOwnerOpen?.();
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    if (process.platform !== "win32") fs.fchmodSync(descriptor, PRIVATE_FILE_MODE);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) throw jobClaimInvalid();
    fs.closeSync(descriptor);
    descriptor = undefined;
    return {
      directory,
      sentinelPath,
      sentinelDev: stat.dev,
      sentinelIno: stat.ino
    };
  } catch {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
        descriptor = undefined;
      } catch {
        // Continue to the inode-fenced cleanup attempt.
      }
    }
    if (openedIdentity) removeRecoverableJobClaimEntry(directory, openedIdentity);
    throw jobClaimInvalid();
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative claim failure.
      }
    }
  }
}

function observeJobClaimLock(lockDirectoryPath: string): ObservedJobClaimLock {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(lockDirectoryPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe");
    const entries = fs.readdirSync(lockDirectoryPath, { withFileTypes: true });
    if (entries.length > 1) throw new Error("unsafe");
    let sentinel: JobClaimLockIdentity | undefined;
    let recoverableEntry: JobClaimFileIdentity | undefined;
    const entry = entries[0];
    if (entry) {
      const match = JOB_CLAIM_OWNER_SENTINEL_PATTERN.exec(entry.name);
      if (!match?.[1] || !entry.isFile() || entry.isSymbolicLink()) throw new Error("unsafe");
      const sentinelPath = path.join(lockDirectoryPath, entry.name);
      const sentinelStat = fs.lstatSync(sentinelPath);
      if (!sentinelStat.isFile() || sentinelStat.isSymbolicLink() || sentinelStat.nlink !== 1) {
        throw new Error("unsafe");
      }
      const candidate = {
        directory: { path: path.resolve(lockDirectoryPath), dev: stat.dev, ino: stat.ino },
        sentinelPath,
        sentinelDev: sentinelStat.dev,
        sentinelIno: sentinelStat.ino
      };
      if (jobClaimOwnerMatches(candidate, match[1])) {
        sentinel = candidate;
      } else {
        recoverableEntry = {
          path: sentinelPath,
          dev: sentinelStat.dev,
          ino: sentinelStat.ino
        };
      }
    }
    return {
      directory: { path: path.resolve(lockDirectoryPath), dev: stat.dev, ino: stat.ino },
      mtimeMs: stat.mtimeMs,
      stat,
      ...(sentinel ? { sentinel } : {}),
      ...(recoverableEntry ? { recoverableEntry } : {})
    };
  } catch {
    throw jobClaimInvalid();
  }
}

function jobClaimOwnerMatches(identity: JobClaimLockIdentity, expectedToken: string): boolean {
  const expectedName = `.owner-${expectedToken}.json`;
  if (
    !JOB_CLAIM_OWNER_TOKEN_PATTERN.test(expectedToken) ||
    path.basename(identity.sentinelPath) !== expectedName ||
    path.dirname(identity.sentinelPath) !== identity.directory.path
  ) {
    return false;
  }
  let descriptor: number | undefined;
  try {
    const stat = fs.lstatSync(identity.sentinelPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > JOB_CLAIM_OWNER_MAX_BYTES) {
      return false;
    }
    if (stat.dev !== identity.sentinelDev || stat.ino !== identity.sentinelIno) return false;
    if (process.platform !== "win32" && (stat.mode & 0o777) !== PRIVATE_FILE_MODE) return false;
    descriptor = fs.openSync(identity.sentinelPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const descriptorStat = fs.fstatSync(descriptor);
    if (descriptorStat.dev !== identity.sentinelDev || descriptorStat.ino !== identity.sentinelIno) return false;
    const bytes = fs.readFileSync(descriptor, "utf8");
    const parsed: unknown = JSON.parse(bytes);
    return isExactJobClaimOwnerRecord(parsed) && parsed.token === expectedToken;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isExactJobClaimOwnerRecord(value: unknown): value is JobClaimOwnerRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 &&
    record.schemaVersion === 1 &&
    typeof record.token === "string" &&
    JOB_CLAIM_OWNER_TOKEN_PATTERN.test(record.token);
}

function removeOwnedJobClaimLock(
  input: {
    readonly claimRootPath: string;
    readonly claimRootIdentity: readonly DirectoryIdentity[];
    readonly lockDirectoryPath: string;
  },
  owned: JobClaimLockIdentity,
  throwOnFailure = false
): void {
  try {
    assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_lost");
    assertDirectoryIdentity(owned.directory, "job.claim_lost");
    const match = JOB_CLAIM_OWNER_SENTINEL_PATTERN.exec(path.basename(owned.sentinelPath));
    if (!match?.[1] || !jobClaimOwnerMatches(owned, match[1])) {
      throw errnoError("ENOTEMPTY", "The Job claim owner was replaced.");
    }
    fs.unlinkSync(owned.sentinelPath);
    assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_lost");
    assertDirectoryIdentity(owned.directory, "job.claim_lost");
    fs.rmdirSync(input.lockDirectoryPath);
    flushDirectoryWhereSupported(input.claimRootPath);
  } catch (caught) {
    if (throwOnFailure) throw caught;
  }
}

function removeRecoverableJobClaimEntry(
  directory: DirectoryIdentity,
  entry: JobClaimFileIdentity,
  throwOnFailure = false
): void {
  try {
    assertDirectoryIdentity(directory, "job.claim_lost");
    if (path.dirname(entry.path) !== directory.path) throw jobClaimLost();
    const stat = fs.lstatSync(entry.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.dev !== entry.dev ||
      stat.ino !== entry.ino
    ) {
      throw jobClaimLost();
    }
    fs.unlinkSync(entry.path);
    flushDirectoryWhereSupported(directory.path);
  } catch (caught) {
    if (throwOnFailure) throw caught;
  }
}

function removeObservedStaleJobClaimLock(
  input: {
    readonly claimRootPath: string;
    readonly claimRootIdentity: readonly DirectoryIdentity[];
    readonly lockDirectoryPath: string;
    readonly timing: JobClaimTiming;
  },
  observed: ObservedJobClaimLock
): void {
  assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
  const current = observeJobClaimLock(input.lockDirectoryPath);
  if (
    !sameDirectoryIdentity(current.directory, observed.directory) ||
    current.mtimeMs !== observed.mtimeMs ||
    current.mtimeMs >= Date.now() - input.timing.staleMs ||
    !sameOptionalSentinel(current.sentinel, observed.sentinel) ||
    !sameOptionalClaimEntry(current.recoverableEntry, observed.recoverableEntry)
  ) {
    throw errnoError("ENOTEMPTY", "The stale Job claim changed before cleanup.");
  }
  if (observed.sentinel) {
    const match = JOB_CLAIM_OWNER_SENTINEL_PATTERN.exec(path.basename(observed.sentinel.sentinelPath));
    if (!match?.[1] || !jobClaimOwnerMatches(observed.sentinel, match[1])) {
      throw errnoError("ENOTEMPTY", "The stale Job claim owner changed before cleanup.");
    }
    fs.unlinkSync(observed.sentinel.sentinelPath);
  } else if (observed.recoverableEntry) {
    removeRecoverableJobClaimEntry(observed.directory, observed.recoverableEntry, true);
  }
  assertDirectoryChainMatches(input.claimRootIdentity, "job.claim_invalid");
  assertDirectoryIdentity(observed.directory, "job.claim_invalid");
  fs.rmdirSync(input.lockDirectoryPath);
  flushDirectoryWhereSupported(input.claimRootPath);
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.path === right.path && left.dev === right.dev && left.ino === right.ino;
}

function sameOptionalSentinel(
  left: JobClaimLockIdentity | undefined,
  right: JobClaimLockIdentity | undefined
): boolean {
  if (!left || !right) return left === right;
  return sameDirectoryIdentity(left.directory, right.directory) &&
    left.sentinelPath === right.sentinelPath &&
    left.sentinelDev === right.sentinelDev &&
    left.sentinelIno === right.sentinelIno;
}

function sameOptionalClaimEntry(
  left: JobClaimFileIdentity | undefined,
  right: JobClaimFileIdentity | undefined
): boolean {
  if (!left || !right) return left === right;
  return left.path === right.path && left.dev === right.dev && left.ino === right.ino;
}

function errnoError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function jobClaimConflict(): PigeDomainError {
  return new PigeDomainError("job.claim_conflict", "Another Job mutation currently owns this record.");
}

function jobClaimInvalid(): PigeDomainError {
  return new PigeDomainError("job.claim_invalid", "The ephemeral Job claim could not be established safely.");
}

function jobClaimLost(): PigeDomainError {
  return new PigeDomainError("job.claim_lost", "The ephemeral Job claim is no longer current.");
}

function readConfinedRegularFile(rootPath: string, filePath: string): FileReadResult {
  const directoryIdentity = ensureSafeDirectoryChain(rootPath, path.dirname(filePath), false);
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) {
      throw new PigeDomainError("job.record_not_found", "The Job record does not exist.");
    }
    throw new PigeDomainError("job.record_unsafe", "The Job record cannot be inspected safely.");
  }
  assertBoundedPrivateRegularFile(pathStatBefore);
  assertRealPathWithinRoot(rootPath, filePath);

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameStableFileStat(pathStatBefore, descriptorStatBefore)) {
      throw new PigeDomainError("job.record_changed", "The Job record changed before it could be read.");
    }
    const bytes = Buffer.alloc(descriptorStatBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      const readCount = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (readCount === 0) break;
      offset += readCount;
    }
    const descriptorStatAfter = fs.fstatSync(descriptor);
    let pathStatAfter: fs.Stats;
    try {
      pathStatAfter = fs.lstatSync(filePath);
    } catch {
      throw new PigeDomainError("job.record_changed", "The Job record changed while it was being read.");
    }
    assertDirectoryChainUnchanged(rootPath, path.dirname(filePath), directoryIdentity);
    if (
      offset !== bytes.length ||
      !sameStableFileStat(descriptorStatBefore, descriptorStatAfter) ||
      !sameStableFileStat(descriptorStatAfter, pathStatAfter)
    ) {
      throw new PigeDomainError("job.record_changed", "The Job record changed while it was being read.");
    }
    return { bytes, stat: descriptorStatAfter };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("job.record_unsafe", "The Job record cannot be read safely.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureSafeDirectoryChain(
  rootPath: string,
  directoryPath: string,
  create: boolean
): readonly DirectoryIdentity[] {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedDirectory = path.resolve(directoryPath);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PigeDomainError("job.path_unsafe", "The Job record directory is outside its owned root.");
  }

  const identities: DirectoryIdentity[] = [];
  inspectDirectory(resolvedRoot, identities);
  const realRoot = fs.realpathSync(resolvedRoot);
  let current = resolvedRoot;
  for (const segment of relative === "" ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!pathExists(current)) {
      if (!create) {
        throw new PigeDomainError("job.record_not_found", "The Job record directory does not exist.");
      }
      try {
        fs.mkdirSync(current, { mode: 0o700 });
        flushDirectoryWhereSupported(path.dirname(current));
      } catch (caught) {
        if (!isErrno(caught, "EEXIST")) {
          throw new PigeDomainError("job.path_unsafe", "The Job record directory cannot be created safely.");
        }
      }
    }
    inspectDirectory(current, identities);
    const realCurrent = fs.realpathSync(current);
    if (realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${path.sep}`)) {
      throw new PigeDomainError("job.path_unsafe", "The Job record directory resolves outside its owned root.");
    }
  }
  return identities;
}

function inspectDirectory(directoryPath: string, identities: DirectoryIdentity[]): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch {
    throw new PigeDomainError("job.path_unsafe", "The Job record directory cannot be inspected safely.");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("job.path_unsafe", "Job record paths cannot traverse symbolic links.");
  }
  identities.push({ path: directoryPath, dev: stat.dev, ino: stat.ino });
}

function assertDirectoryChainUnchanged(
  rootPath: string,
  directoryPath: string,
  expected: readonly DirectoryIdentity[]
): void {
  const current = ensureSafeDirectoryChain(rootPath, directoryPath, false);
  if (
    current.length !== expected.length ||
    current.some((identity, index) => {
      const previous = expected[index];
      return !previous ||
        identity.path !== previous.path ||
        identity.dev !== previous.dev ||
        identity.ino !== previous.ino;
    })
  ) {
    throw new PigeDomainError("job.record_changed", "The Job record path changed while it was being read.");
  }
}

function assertBoundedPrivateRegularFile(stat: fs.Stats): void {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size < 0 ||
    stat.size > MAX_JOB_RECORD_BYTES
  ) {
    throw new PigeDomainError("job.record_unsafe", "The Job record is not a bounded private regular file.");
  }
}

function assertRealPathWithinRoot(rootPath: string, filePath: string): void {
  const realRoot = fs.realpathSync(rootPath);
  const realFile = fs.realpathSync(filePath);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new PigeDomainError("job.path_unsafe", "The Job record resolves outside its owned root.");
  }
}

function sameStableFileStat(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() &&
    right.isFile() &&
    !left.isSymbolicLink() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mode === right.mode &&
    left.nlink === 1 &&
    right.nlink === 1;
}

function revisionFor(bytes: Buffer, stat: fs.Stats): JobRecordRevision {
  return {
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    size: bytes.length,
    dev: stat.dev,
    ino: stat.ino
  };
}

function sameRevision(left: JobRecordRevision, right: JobRecordRevision): boolean {
  return left.sha256 === right.sha256 &&
    left.size === right.size &&
    left.dev === right.dev &&
    left.ino === right.ino;
}

function assertSnapshotShape(snapshot: JobRecordSnapshot, resolvedPath: string): void {
  const parsedJob = JobRecordSchema.safeParse(snapshot?.job);
  const revision = snapshot?.revision;
  if (
    !snapshot ||
    snapshot.path !== resolvedPath ||
    !parsedJob.success ||
    !revision ||
    !/^sha256:[a-f0-9]{64}$/u.test(revision.sha256) ||
    !Number.isSafeInteger(revision.size) ||
    revision.size < 0 ||
    !Number.isSafeInteger(revision.dev) ||
    !Number.isSafeInteger(revision.ino)
  ) {
    throw revisionConflict();
  }
}

function parseNextJob(next: JobRecord): JobRecord {
  try {
    return JobRecordSchema.parse(next);
  } catch {
    throw new PigeDomainError("job.record_invalid", "The replacement Job record is invalid.");
  }
}

function assertJobMatchesPath(filePath: string, job: JobRecord): void {
  if (path.basename(filePath) !== `${job.id}.json`) {
    throw new PigeDomainError("job.record_invalid", "The Job record identity does not match its path.");
  }
}

function serializeJob(job: JobRecord): Buffer {
  const bytes = Buffer.from(`${JSON.stringify(job, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_JOB_RECORD_BYTES) {
    throw new PigeDomainError("job.record_invalid", "The Job record exceeds its bounded size.");
  }
  return bytes;
}

function writePrivateTemporaryFile(filePath: string, bytes: Buffer): string {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW ?? 0),
      PRIVATE_FILE_MODE
    );
    let offset = 0;
    while (offset < bytes.length) {
      offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    }
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return temporaryPath;
  } catch (caught) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the authoritative write failure.
      }
    }
    removeTemporaryFile(temporaryPath);
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("job.write_failed", "A private Job record temporary file could not be written.");
  }
}

function assertCommittedSnapshot(snapshot: JobRecordSnapshot, expectedBytes: Buffer): JobRecordSnapshot {
  const expected = `sha256:${createHash("sha256").update(expectedBytes).digest("hex")}`;
  if (snapshot.revision.sha256 !== expected || snapshot.revision.size !== expectedBytes.length) {
    throw new PigeDomainError("job.write_failed", "The committed Job record bytes do not match the requested write.");
  }
  return snapshot;
}

function removeTemporaryFile(temporaryPath: string): void {
  try {
    fs.rmSync(temporaryPath, { force: true });
  } catch {
    // Cleanup must not replace the authoritative result.
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
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Directory cleanup must not replace the durable write result.
      }
    }
  }
}

function isUnsupportedDirectoryFlush(value: unknown): boolean {
  if (!(value instanceof Error) || !("code" in value)) return false;
  const code = String(value.code);
  if (new Set(["EBADF", "EINVAL", "ENOSYS", "ENOTSUP"]).has(code)) return true;
  return process.platform === "win32" && new Set(["EACCES", "EISDIR", "EPERM"]).has(code);
}

function pathExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return false;
    throw new PigeDomainError("job.path_unsafe", "The Job record path cannot be inspected safely.");
  }
}

function revisionConflict(): PigeDomainError {
  return new PigeDomainError(
    "job.revision_conflict",
    "The Job record changed before this mutation could be committed."
  );
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}
