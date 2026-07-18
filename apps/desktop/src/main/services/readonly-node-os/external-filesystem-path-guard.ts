import { Buffer } from "node:buffer";
import fs, { type BigIntStats } from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

export const MAX_EXTERNAL_PATH_UTF8_BYTES = 4_096;

interface ProtectedRoot {
  readonly lexicalPath: string;
  readonly realPath?: string;
}

export interface ExternalExistingPath {
  readonly path: string;
  readonly stats: BigIntStats;
}

export interface ExternalTargetParent {
  readonly path: string;
  readonly parentPath: string;
  readonly parentStats: BigIntStats;
}

export class ExternalFilesystemPathGuard {
  readonly #protectedRoots: readonly ProtectedRoot[];

  constructor(protectedRoots: readonly string[] = []) {
    this.#protectedRoots = Object.freeze(protectedRoots.map(normalizeProtectedRoot));
  }

  captureExisting(value: unknown): ExternalExistingPath {
    const lexicalPath = normalizeExternalAbsolutePath(value);
    this.#assertNotProtected(lexicalPath, false);
    const stats = lstatExternal(lexicalPath);
    if (stats.isSymbolicLink()) throw externalFilesystemError("external_filesystem.symlink_not_allowed");
    let realPath: string;
    try {
      realPath = fs.realpathSync.native(lexicalPath);
    } catch {
      throw externalFilesystemError("external_filesystem.unavailable");
    }
    this.#assertNotProtected(realPath, true);
    if (!sameExternalPath(lexicalPath, realPath)) {
      assertExternalIdentity(stats, lstatExternal(realPath));
    }
    return Object.freeze({ path: lexicalPath, stats });
  }

  captureTargetParent(value: unknown): ExternalTargetParent {
    const targetPath = normalizeExternalAbsolutePath(value);
    this.#assertNotProtected(targetPath, false);
    const parentPath = path.dirname(targetPath);
    const parent = this.captureExisting(parentPath);
    if (!parent.stats.isDirectory()) throw externalFilesystemError("external_filesystem.not_directory");
    return Object.freeze({ path: targetPath, parentPath, parentStats: parent.stats });
  }

  assertParentCurrent(parent: ExternalTargetParent): void {
    assertExternalIdentity(parent.parentStats, this.captureExisting(parent.parentPath).stats);
  }

  isProtectedEntry(parentPath: string, entryName: string): boolean {
    const childPath = path.join(parentPath, entryName);
    return this.#protectedRoots.some((root) => sameExternalPath(childPath, root.lexicalPath));
  }

  #assertNotProtected(candidatePath: string, useRealRoots: boolean): void {
    for (const root of this.#protectedRoots) {
      const protectedPath = useRealRoots ? (root.realPath ?? root.lexicalPath) : root.lexicalPath;
      if (isSameOrDescendant(candidatePath, protectedPath)) {
        throw externalFilesystemError("external_filesystem.protected_path");
      }
    }
  }
}

export function normalizeExternalAbsolutePath(value: unknown): string {
  if (typeof value !== "string") throw externalFilesystemError("external_filesystem.invalid_input");
  if (
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_EXTERNAL_PATH_UTF8_BYTES ||
    !path.isAbsolute(value)
  ) throw externalFilesystemError("external_filesystem.path_not_absolute");
  return path.resolve(value);
}

export function lstatExternal(filePath: string): BigIntStats {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch {
    throw externalFilesystemError("external_filesystem.unavailable");
  }
}

export function assertExternalIdentity(left: BigIntStats, right: BigIntStats): void {
  if (left.dev !== right.dev || left.ino !== right.ino || left.mode !== right.mode) {
    throw externalFilesystemError("external_filesystem.changed");
  }
}

export function sameExternalPath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

export function externalFilesystemError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The external filesystem request could not be completed safely.");
}

function normalizeProtectedRoot(value: string): ProtectedRoot {
  const lexicalPath = normalizeExternalAbsolutePath(value);
  try {
    return { lexicalPath, realPath: fs.realpathSync.native(lexicalPath) };
  } catch {
    return { lexicalPath };
  }
}

function isSameOrDescendant(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(normalizeForComparison(rootPath), normalizeForComparison(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}
