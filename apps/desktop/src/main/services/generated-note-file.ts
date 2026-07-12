import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const GENERATED_NOTE_HEADER_READ_LIMIT_BYTES = 128 * 1024;

export type GeneratedNoteCommitResult = "created" | "exists";
export type GeneratedNoteReplaceResult = "updated" | "already_updated";

export interface GeneratedNoteCommitHooks {
  readonly beforeFinalSourceCheck?: () => void;
  readonly assertSourceCurrent?: () => void;
  readonly onPublicationStart?: () => void;
  readonly afterPublicationStart?: () => void;
}

export function readGeneratedNoteHeader(vaultPath: string, filePath: string): string | undefined {
  if (!ensureSafeParent(vaultPath, filePath, false)) return undefined;
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw pageConflict("The generated-note target cannot be inspected safely.");
  }
  if (!pathStatBefore.isFile() || pathStatBefore.isSymbolicLink()) {
    throw pageConflict("The generated-note target is not a regular file.");
  }
  assertFileResolvesWithinVault(vaultPath, filePath);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw pageConflict("The generated-note target cannot be opened safely.");
  }
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (!sameFileRevision(pathStatBefore, descriptorStatBefore)) {
      throw pageConflict("The generated-note target changed before it could be read.");
    }
    const bytesToRead = Math.min(descriptorStatBefore.size, GENERATED_NOTE_HEADER_READ_LIMIT_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = bytesToRead === 0 ? 0 : fs.readSync(descriptor, buffer, 0, bytesToRead, 0);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    let pathStatAfter: fs.Stats;
    try {
      pathStatAfter = fs.lstatSync(filePath);
    } catch {
      throw pageConflict("The generated-note target changed while it was being read.");
    }
    if (
      !sameFileRevision(descriptorStatBefore, descriptorStatAfter) ||
      !sameFileRevision(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink()
    ) {
      throw pageConflict("The generated-note target changed while it was being read.");
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readGeneratedNoteExact(
  vaultPath: string,
  filePath: string,
  maximumBytes: number
): string | undefined {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw pageConflict("The generated-note read limit is invalid.");
  }
  if (!ensureSafeParent(vaultPath, filePath, false)) return undefined;
  let pathStatBefore: fs.Stats;
  try {
    pathStatBefore = fs.lstatSync(filePath);
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return undefined;
    throw pageConflict("The generated-note target cannot be inspected safely.");
  }
  if (
    !pathStatBefore.isFile() ||
    pathStatBefore.isSymbolicLink() ||
    pathStatBefore.nlink !== 1 ||
    pathStatBefore.size > maximumBytes
  ) {
    throw pageConflict("The generated-note target is not a bounded private regular file.");
  }
  assertFileResolvesWithinVault(vaultPath, filePath);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch {
    throw pageConflict("The generated-note target cannot be opened safely.");
  }
  try {
    const descriptorStatBefore = fs.fstatSync(descriptor);
    if (
      !sameFileRevision(pathStatBefore, descriptorStatBefore) ||
      descriptorStatBefore.nlink !== 1 ||
      descriptorStatBefore.size > maximumBytes
    ) {
      throw pageConflict("The generated-note target changed before it could be read.");
    }
    const buffer = Buffer.alloc(descriptorStatBefore.size);
    const bytesRead = descriptorStatBefore.size === 0
      ? 0
      : fs.readSync(descriptor, buffer, 0, descriptorStatBefore.size, 0);
    const descriptorStatAfter = fs.fstatSync(descriptor);
    let pathStatAfter: fs.Stats;
    try {
      pathStatAfter = fs.lstatSync(filePath);
    } catch {
      throw pageConflict("The generated-note target changed while it was being read.");
    }
    if (
      bytesRead !== descriptorStatBefore.size ||
      !sameFileRevision(descriptorStatBefore, descriptorStatAfter) ||
      !sameFileRevision(descriptorStatAfter, pathStatAfter) ||
      pathStatAfter.isSymbolicLink() ||
      pathStatAfter.nlink !== 1
    ) {
      throw pageConflict("The generated-note target changed while it was being read.");
    }
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function ensureGeneratedNoteParentSafe(vaultPath: string, filePath: string): void {
  ensureSafeParent(vaultPath, filePath, true);
}

export function createGeneratedNoteExclusive(
  vaultPath: string,
  filePath: string,
  value: string,
  hooks: GeneratedNoteCommitHooks = {}
): GeneratedNoteCommitResult {
  ensureSafeParent(vaultPath, filePath, true);
  if (targetExists(filePath)) return "exists";
  const parentIdentity = captureSafeParentIdentity(vaultPath, filePath);

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  let linkedTarget = false;
  let committed = false;
  let temporaryIdentity: fs.Stats | undefined;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    const openedStat = fs.fstatSync(descriptor);
    const openedPathStat = fs.lstatSync(temporaryPath);
    assertSafeParentIdentity(vaultPath, filePath, parentIdentity);
    if (
      openedStat.nlink !== 1 ||
      openedPathStat.nlink !== 1 ||
      !sameIdentity(openedStat, openedPathStat)
    ) {
      throw pageConflict("The generated-note temporary file is not private.");
    }
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    const temporaryStat = fs.fstatSync(descriptor);
    if (temporaryStat.nlink !== 1 || !sameInodeIdentity(openedStat, temporaryStat)) {
      throw pageConflict("The generated-note temporary file changed during write.");
    }
    temporaryIdentity = temporaryStat;
    fs.closeSync(descriptor);
    descriptor = undefined;

    hooks.beforeFinalSourceCheck?.();
    hooks.assertSourceCurrent?.();
    hooks.onPublicationStart?.();
    hooks.afterPublicationStart?.();
    hooks.assertSourceCurrent?.();
    ensureSafeParent(vaultPath, filePath, false);
    assertSafeParentIdentity(vaultPath, filePath, parentIdentity);
    if (targetExists(filePath)) return "exists";

    const temporaryBeforeLink = fs.lstatSync(temporaryPath);
    if (temporaryBeforeLink.nlink !== 1 || !sameIdentity(temporaryStat, temporaryBeforeLink)) {
      throw pageConflict("The generated-note temporary file changed before commit.");
    }

    try {
      fs.linkSync(temporaryPath, filePath);
      linkedTarget = true;
    } catch (caught) {
      if (isErrno(caught, "EEXIST")) return "exists";
      throw caught;
    }

    let committedStat: fs.Stats;
    try {
      committedStat = fs.lstatSync(filePath);
    } catch {
      throw pageConflict("The generated note changed immediately after commit.");
    }
    const temporaryAfterLink = fs.lstatSync(temporaryPath);
    if (
      committedStat.isSymbolicLink() ||
      committedStat.nlink !== 2 ||
      temporaryAfterLink.nlink !== 2 ||
      !sameIdentity(temporaryStat, committedStat) ||
      !sameIdentity(committedStat, temporaryAfterLink)
    ) {
      throw pageConflict("The generated note changed immediately after commit.");
    }
    fs.rmSync(temporaryPath);
    const privateCommittedStat = fs.lstatSync(filePath);
    if (privateCommittedStat.nlink !== 1 || !sameIdentity(committedStat, privateCommittedStat)) {
      throw pageConflict("The generated note did not become a private committed file.");
    }
    flushDirectoryWhereSupported(path.dirname(filePath));
    committed = true;
    return "created";
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(
      "agent_ingest.note_commit_failed",
      "Pige could not commit the generated note without replacing an existing page."
    );
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // The authoritative commit result remains unchanged.
      }
    }
    if (!committed && linkedTarget && temporaryIdentity) {
      try {
        const targetStat = fs.lstatSync(filePath);
        if (!targetStat.isSymbolicLink() && sameIdentity(temporaryIdentity, targetStat)) {
          fs.rmSync(filePath);
        }
      } catch {
        // Never remove a path whose identity cannot be proven to be this failed commit.
      }
    }
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // A cleanup failure must not replace the commit result.
    }
  }
}

export function replaceGeneratedNoteExact(
  vaultPath: string,
  filePath: string,
  replacementPath: string,
  input: {
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly maximumBytes: number;
  }
): GeneratedNoteReplaceResult {
  ensureSafeParent(vaultPath, filePath, false);
  ensureSafeParent(vaultPath, replacementPath, false);
  const current = readGeneratedNoteExact(vaultPath, filePath, input.maximumBytes);
  if (current === undefined) throw pageConflict("The generated-note update target is unavailable.");
  const currentHash = hashText(current);
  if (currentHash === input.afterHash) {
    removeGeneratedNoteExact(vaultPath, replacementPath, input.afterHash, input.maximumBytes);
    return "already_updated";
  }
  if (currentHash !== input.beforeHash) {
    throw pageConflict("The generated-note update target changed after its base hash was approved.");
  }
  const replacement = readGeneratedNoteExact(vaultPath, replacementPath, input.maximumBytes);
  if (replacement === undefined || hashText(replacement) !== input.afterHash) {
    throw pageConflict("The staged generated-note update is unavailable or changed.");
  }

  const targetParent = captureSafeParentIdentity(vaultPath, filePath);
  const replacementParent = captureSafeParentIdentity(vaultPath, replacementPath);
  const currentBeforeCommit = readGeneratedNoteExact(vaultPath, filePath, input.maximumBytes);
  const replacementBeforeCommit = readGeneratedNoteExact(vaultPath, replacementPath, input.maximumBytes);
  if (
    currentBeforeCommit === undefined ||
    replacementBeforeCommit === undefined ||
    hashText(currentBeforeCommit) !== input.beforeHash ||
    hashText(replacementBeforeCommit) !== input.afterHash
  ) {
    throw pageConflict("The generated-note update changed during its final base-hash check.");
  }
  assertSafeParentIdentity(vaultPath, filePath, targetParent);
  assertSafeParentIdentity(vaultPath, replacementPath, replacementParent);
  try {
    fs.renameSync(replacementPath, filePath);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw pageConflict("The generated-note update could not be committed atomically.");
  }
  flushDirectoryWhereSupported(path.dirname(filePath));
  if (path.dirname(replacementPath) !== path.dirname(filePath)) {
    flushDirectoryWhereSupported(path.dirname(replacementPath));
  }
  const committed = readGeneratedNoteExact(vaultPath, filePath, input.maximumBytes);
  if (committed === undefined || hashText(committed) !== input.afterHash) {
    throw pageConflict("The generated-note update could not be verified after commit.");
  }
  return "updated";
}

export function removeGeneratedNoteExact(
  vaultPath: string,
  filePath: string,
  expectedHash: string,
  maximumBytes: number
): void {
  const current = readGeneratedNoteExact(vaultPath, filePath, maximumBytes);
  if (current === undefined) return;
  if (hashText(current) !== expectedHash) {
    throw pageConflict("A private generated-note recovery file contains unexpected content.");
  }
  const parent = captureSafeParentIdentity(vaultPath, filePath);
  const before = fs.lstatSync(filePath);
  const verified = readGeneratedNoteExact(vaultPath, filePath, maximumBytes);
  const after = fs.lstatSync(filePath);
  if (
    verified === undefined ||
    hashText(verified) !== expectedHash ||
    !sameFileRevision(before, after)
  ) {
    throw pageConflict("A private generated-note recovery file changed before cleanup.");
  }
  assertSafeParentIdentity(vaultPath, filePath, parent);
  fs.unlinkSync(filePath);
  flushDirectoryWhereSupported(path.dirname(filePath));
}

function captureSafeParentIdentity(vaultPath: string, filePath: string): fs.Stats {
  ensureSafeParent(vaultPath, filePath, false);
  const parentPath = path.dirname(path.resolve(filePath));
  const parentStat = fs.lstatSync(parentPath);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw pageConflict("The generated-note parent is not a safe directory.");
  }
  assertParentResolvesWithinVault(vaultPath, parentPath);
  return parentStat;
}

function assertSafeParentIdentity(
  vaultPath: string,
  filePath: string,
  expected: fs.Stats
): void {
  const parentPath = path.dirname(path.resolve(filePath));
  const current = fs.lstatSync(parentPath);
  if (!sameDirectoryIdentity(expected, current) || current.isSymbolicLink()) {
    throw pageConflict("The generated-note parent changed during commit.");
  }
  assertParentResolvesWithinVault(vaultPath, parentPath);
}

function assertParentResolvesWithinVault(vaultPath: string, parentPath: string): void {
  const realVaultPath = fs.realpathSync(path.resolve(vaultPath));
  const realParentPath = fs.realpathSync(parentPath);
  if (!isContainedPath(realParentPath, realVaultPath)) {
    throw pageConflict("The generated-note parent resolves outside the active vault.");
  }
}

function ensureSafeParent(vaultPath: string, filePath: string, create: boolean): boolean {
  const resolvedVaultPath = path.resolve(vaultPath);
  const resolvedFilePath = path.resolve(filePath);
  if (resolvedFilePath === resolvedVaultPath || !isContainedPath(resolvedFilePath, resolvedVaultPath)) {
    throw pageConflict("The generated-note path escapes the active vault.");
  }
  let vaultStat: fs.Stats;
  try {
    vaultStat = fs.lstatSync(resolvedVaultPath);
  } catch {
    throw pageConflict("The active vault cannot be inspected safely.");
  }
  if (!vaultStat.isDirectory() || vaultStat.isSymbolicLink()) {
    throw pageConflict("The active vault is not a safe directory.");
  }

  const relativeParent = path.relative(resolvedVaultPath, path.dirname(resolvedFilePath));
  let current = resolvedVaultPath;
  for (const component of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (caught) {
      if (!isErrno(caught, "ENOENT")) {
        throw pageConflict("A generated-note parent cannot be inspected safely.");
      }
      if (!create) return false;
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isErrno(mkdirError, "EEXIST")) {
          throw new PigeDomainError(
            "agent_ingest.note_commit_failed",
            "Pige could not create the generated-note directory."
          );
        }
      }
      try {
        stat = fs.lstatSync(current);
      } catch {
        throw pageConflict("A generated-note parent changed during directory creation.");
      }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw pageConflict("A generated-note parent is not a safe directory.");
    }
  }

  let realVaultPath: string;
  let realParentPath: string;
  try {
    realVaultPath = fs.realpathSync(resolvedVaultPath);
    realParentPath = fs.realpathSync(path.dirname(resolvedFilePath));
  } catch {
    throw pageConflict("A generated-note parent cannot be resolved safely.");
  }
  if (!isContainedPath(realParentPath, realVaultPath)) {
    throw pageConflict("A generated-note parent resolves outside the active vault.");
  }
  return true;
}

function assertFileResolvesWithinVault(vaultPath: string, filePath: string): void {
  let realVaultPath: string;
  let realFilePath: string;
  try {
    realVaultPath = fs.realpathSync(path.resolve(vaultPath));
    realFilePath = fs.realpathSync(filePath);
  } catch {
    throw pageConflict("The generated-note target cannot be resolved safely.");
  }
  if (!isContainedPath(realFilePath, realVaultPath)) {
    throw pageConflict("The generated-note target resolves outside the active vault.");
  }
}

function targetExists(filePath: string): boolean {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (caught) {
    if (isErrno(caught, "ENOENT")) return false;
    throw pageConflict("The generated-note target cannot be inspected safely.");
  }
}

function flushDirectoryWhereSupported(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // A directory-handle cleanup failure must not replace a successful commit.
      }
    }
  }
}

function sameIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size;
}

function sameInodeIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
}

function sameDirectoryIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.isDirectory() && right.isDirectory() && left.dev === right.dev && left.ino === right.ino;
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameIdentity(left, right) &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}

function pageConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_ingest.page_conflict", message);
}
