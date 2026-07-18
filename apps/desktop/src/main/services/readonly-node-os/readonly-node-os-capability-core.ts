import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs, { constants as fsConstants, type BigIntStats, type Dirent } from "node:fs";
import { PigeDomainError } from "@pige/domain";
import {
  assertExternalIdentity,
  externalFilesystemError,
  ExternalFilesystemPathGuard,
  lstatExternal,
  MAX_EXTERNAL_PATH_UTF8_BYTES,
  normalizeExternalAbsolutePath
} from "./external-filesystem-path-guard";

export { MAX_EXTERNAL_PATH_UTF8_BYTES, normalizeExternalAbsolutePath } from "./external-filesystem-path-guard";
export const MAX_EXTERNAL_LIST_ENTRIES = 128;
export const MAX_EXTERNAL_TEXT_BYTES = 48 * 1_024;
const MAX_EXTERNAL_LIST_PROJECTION_BYTES = 24 * 1_024;

export interface ExternalFilesystemProtectionOptions {
  readonly protectedRoots?: readonly string[];
}

export interface ExternalDirectoryEntry {
  readonly name: string;
  readonly kind: "directory" | "file" | "symlink" | "other";
}

export interface ExternalDirectoryListResult {
  readonly entries: readonly ExternalDirectoryEntry[];
  readonly truncated: boolean;
  readonly identityHash: `sha256:${string}`;
  readonly revisionHash: `sha256:${string}`;
}

export interface ExternalTextReadResult {
  readonly text: string;
  readonly byteLength: number;
  readonly identityHash: `sha256:${string}`;
  readonly revisionHash: `sha256:${string}`;
}

export class ReadonlyExternalFilesystemCore {
  readonly #guard: ExternalFilesystemPathGuard;

  constructor(options: ExternalFilesystemProtectionOptions = {}) {
    this.#guard = new ExternalFilesystemPathGuard(options.protectedRoots);
  }

  async list(
    absolutePath: string,
    maxEntries: number,
    signal: AbortSignal
  ): Promise<ExternalDirectoryListResult> {
    assertNotAborted(signal);
    const target = this.#guard.captureExisting(absolutePath);
    const before = target.stats;
    if (!before.isDirectory()) throw filesystemError("external_filesystem.not_directory");
    const handle = await openNoFollow(target.path, true);
    try {
      const openedBefore = await handle.stat({ bigint: true });
      assertSameIdentity(before, openedBefore);
      const directory = await fs.promises.opendir(target.path);
      const entries: ExternalDirectoryEntry[] = [];
      let truncated = false;
      try {
        while (entries.length < maxEntries) {
          assertNotAborted(signal);
          const entry = await directory.read();
          if (!entry) break;
          if (this.#guard.isProtectedEntry(target.path, entry.name)) continue;
          const projected = projectDirectoryEntry(entry);
          if (projectedEntriesBytes([...entries, projected]) > MAX_EXTERNAL_LIST_PROJECTION_BYTES) {
            truncated = true;
            break;
          }
          entries.push(projected);
        }
        if (entries.length === maxEntries) {
          for (;;) {
            assertNotAborted(signal);
            const extra = await directory.read();
            if (!extra) break;
            if (!this.#guard.isProtectedEntry(target.path, extra.name)) {
              truncated = true;
              break;
            }
          }
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
      assertNotAborted(signal);
      const openedAfter = await handle.stat({ bigint: true });
      const pathAfter = lstatExternal(target.path);
      assertSameRevision(openedBefore, openedAfter);
      assertSameIdentity(openedAfter, pathAfter);
      const identityHash = hashIdentity(openedAfter);
      const revisionHash = hashCanonical("pige.external_fs.directory_revision.v1", {
        identityHash,
        mtimeNs: openedAfter.mtimeNs.toString(),
        ctimeNs: openedAfter.ctimeNs.toString(),
        entries,
        truncated
      });
      return Object.freeze({ entries: Object.freeze(entries), truncated, identityHash, revisionHash });
    } finally {
      await handle.close();
    }
  }

  async readText(
    absolutePath: string,
    maxBytes: number,
    signal: AbortSignal
  ): Promise<ExternalTextReadResult> {
    assertNotAborted(signal);
    const target = this.#guard.captureExisting(absolutePath);
    const before = target.stats;
    if (!before.isFile()) throw filesystemError("external_filesystem.not_file");
    const handle = await openNoFollow(target.path, false);
    try {
      const openedBefore = await handle.stat({ bigint: true });
      assertSameIdentity(before, openedBefore);
      if (!openedBefore.isFile()) throw filesystemError("external_filesystem.not_file");
      if (openedBefore.size > BigInt(maxBytes)) throw filesystemError("external_filesystem.file_too_large");
      const expectedBytes = Number(openedBefore.size);
      const bytes = Buffer.allocUnsafe(expectedBytes);
      let offset = 0;
      while (offset < expectedBytes) {
        assertNotAborted(signal);
        const read = await handle.read(bytes, offset, expectedBytes - offset, offset);
        if (read.bytesRead === 0) throw filesystemError("external_filesystem.changed");
        offset += read.bytesRead;
      }
      assertNotAborted(signal);
      const openedAfter = await handle.stat({ bigint: true });
      const pathAfter = lstatExternal(target.path);
      assertSameRevision(openedBefore, openedAfter);
      assertSameIdentity(openedAfter, pathAfter);
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw filesystemError("external_filesystem.invalid_utf8");
      }
      const identityHash = hashIdentity(openedAfter);
      const contentHash = hashBytes("pige.external_fs.file_content.v1", bytes);
      const revisionHash = hashCanonical("pige.external_fs.file_revision.v1", {
        identityHash,
        size: openedAfter.size.toString(),
        mtimeNs: openedAfter.mtimeNs.toString(),
        ctimeNs: openedAfter.ctimeNs.toString(),
        contentHash
      });
      return Object.freeze({ text, byteLength: bytes.byteLength, identityHash, revisionHash });
    } finally {
      await handle.close();
    }
  }

}

export function requireBoundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  code: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new PigeDomainError(code, "The requested external capability limit is invalid.");
  }
  return value as number;
}

export function hashExternalResource(kind: string, value: string): `sha256:${string}` {
  return hashCanonical("pige.external_resource_identity.v1", { kind, value });
}


async function openNoFollow(filePath: string, directory: boolean): Promise<fs.promises.FileHandle> {
  const flags = fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (directory ? (fsConstants.O_DIRECTORY ?? 0) : 0);
  try {
    return await fs.promises.open(filePath, flags);
  } catch (caught) {
    if (isErrno(caught, "ELOOP")) throw filesystemError("external_filesystem.symlink_not_allowed");
    throw filesystemError("external_filesystem.unavailable");
  }
}

function projectDirectoryEntry(entry: Dirent): ExternalDirectoryEntry {
  return Object.freeze({
    name: entry.name,
    kind: entry.isFile()
      ? "file"
      : entry.isDirectory()
        ? "directory"
        : entry.isSymbolicLink()
          ? "symlink"
          : "other"
  });
}

function projectedEntriesBytes(entries: readonly ExternalDirectoryEntry[]): number {
  return Buffer.byteLength(JSON.stringify({ entries, truncated: true }), "utf8");
}

function assertSameIdentity(left: BigIntStats, right: BigIntStats): void {
  assertExternalIdentity(left, right);
}

function assertSameRevision(left: BigIntStats, right: BigIntStats): void {
  assertSameIdentity(left, right);
  if (
    left.size !== right.size ||
    left.mtimeNs !== right.mtimeNs ||
    left.ctimeNs !== right.ctimeNs
  ) throw filesystemError("external_filesystem.changed");
}

function hashIdentity(stats: BigIntStats): `sha256:${string}` {
  return hashCanonical("pige.external_fs.identity.v1", {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    mode: stats.mode.toString(),
    birthtimeNs: stats.birthtimeNs.toString()
  });
}

function hashBytes(domain: string, bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(domain, "utf8").update("\0", "utf8").update(bytes).digest("hex")}`;
}

function hashCanonical(domain: string, value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw filesystemError("external_filesystem.cancelled");
}

function isErrno(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

function filesystemError(code: string): PigeDomainError {
  return externalFilesystemError(code);
}
