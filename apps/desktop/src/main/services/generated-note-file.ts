import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const GENERATED_NOTE_HEADER_READ_LIMIT_BYTES = 128 * 1024;

export type GeneratedNoteCommitResult = "created" | "exists";

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

export function createGeneratedNoteExclusive(
  vaultPath: string,
  filePath: string,
  value: string,
  hooks: GeneratedNoteCommitHooks = {}
): GeneratedNoteCommitResult {
  ensureSafeParent(vaultPath, filePath, true);
  if (targetExists(filePath)) return "exists";

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    const flags = fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW ?? 0);
    descriptor = fs.openSync(temporaryPath, flags, 0o600);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    const temporaryStat = fs.fstatSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;

    hooks.beforeFinalSourceCheck?.();
    hooks.assertSourceCurrent?.();
    hooks.onPublicationStart?.();
    hooks.afterPublicationStart?.();
    hooks.assertSourceCurrent?.();
    ensureSafeParent(vaultPath, filePath, false);
    if (targetExists(filePath)) return "exists";

    try {
      fs.linkSync(temporaryPath, filePath);
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
    if (committedStat.isSymbolicLink() || !sameIdentity(temporaryStat, committedStat)) {
      throw pageConflict("The generated note changed immediately after commit.");
    }
    flushDirectoryWhereSupported(path.dirname(filePath));
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
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // A cleanup failure must not replace the commit result.
    }
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

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return sameIdentity(left, right) &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && value.code === code;
}

function pageConflict(message: string): PigeDomainError {
  return new PigeDomainError("agent_ingest.page_conflict", message);
}
