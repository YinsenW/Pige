import fs from "node:fs";
import path from "node:path";
import {
  PiPackageCatalogEntrySchema,
  PiPackageCatalogQueryRequestSchema,
  PiPackageCatalogQueryResultSchema,
  type PiPackageCatalogEntry,
  type PiPackageCatalogQueryRequest,
  type PiPackageCatalogQueryResult
} from "@pige/schemas";

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_CATALOG_ENTRIES = 100;
const MANIFEST_KEYS = new Set(["schemaVersion", "entries"]);

export class PiPackageCatalogService {
  readonly #manifestPath: string;

  constructor(manifestPath: string) {
    if (!path.isAbsolute(manifestPath)) throw new Error("Pi package catalog path must be absolute.");
    const resolved = path.resolve(manifestPath);
    this.#manifestPath = path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved));
  }

  query(request: PiPackageCatalogQueryRequest): PiPackageCatalogQueryResult {
    const parsed = PiPackageCatalogQueryRequestSchema.parse(request);
    try {
      const entries = readCatalog(this.#manifestPath);
      const queryTerms = normalizeSearch(parsed.query).split(" ").filter(Boolean);
      const matches = queryTerms.length === 0
        ? entries
        : entries.filter((entry) => matchesQuery(entry, queryTerms));
      return PiPackageCatalogQueryResultSchema.parse({
        apiVersion: parsed.apiVersion,
        requestId: parsed.requestId,
        status: "ready",
        entries: matches,
        total: matches.length
      });
    } catch {
      return PiPackageCatalogQueryResultSchema.parse({
        apiVersion: parsed.apiVersion,
        requestId: parsed.requestId,
        status: "failed"
      });
    }
  }
}

function readCatalog(manifestPath: string): readonly PiPackageCatalogEntry[] {
  const bytes = readRegularFileNoFollow(manifestPath);
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(raw) || !hasExactKeys(raw, MANIFEST_KEYS) || raw.schemaVersion !== 1 ||
    !Array.isArray(raw.entries) || raw.entries.length < 1 || raw.entries.length > MAX_CATALOG_ENTRIES) {
    throw new Error("Pi package catalog manifest is invalid.");
  }

  const entries = raw.entries.map((entry) => PiPackageCatalogEntrySchema.parse(entry));
  entries.sort(compareCatalogIds);
  const catalogIds = new Set<string>();
  const packageVersions = new Set<string>();
  for (const entry of entries) {
    const packageVersion = `${entry.packageName}@${entry.version}`;
    if (catalogIds.has(entry.catalogId) || packageVersions.has(packageVersion)) {
      throw new Error("Pi package catalog entries must be unique.");
    }
    catalogIds.add(entry.catalogId);
    packageVersions.add(packageVersion);
  }
  return Object.freeze(entries);
}

function readRegularFileNoFollow(filePath: string): Buffer {
  const parentPath = path.dirname(filePath);
  const parentBefore = fs.lstatSync(parentPath);
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink() || fs.realpathSync.native(parentPath) !== parentPath) {
    throw new Error("Pi package catalog parent is unsafe.");
  }

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      before.size < 1 || before.size > MAX_MANIFEST_BYTES) {
      throw new Error("Pi package catalog must be a bounded regular file.");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    const parentAfter = fs.lstatSync(parentPath);
    if (offset !== before.size || !sameFileIdentity(before, after) || !sameFileIdentity(before, pathAfter) ||
      !sameDirectoryIdentity(parentBefore, parentAfter) || fs.realpathSync.native(parentPath) !== parentPath) {
      throw new Error("Pi package catalog changed while it was read.");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function matchesQuery(entry: PiPackageCatalogEntry, terms: readonly string[]): boolean {
  const searchable = normalizeSearch([
    entry.packageName,
    entry.displayName,
    entry.purpose,
    ...entry.capabilities
  ].join(" "));
  return terms.every((term) => searchable.includes(term));
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function compareCatalogIds(left: PiPackageCatalogEntry, right: PiPackageCatalogEntry): number {
  return left.catalogId < right.catalogId ? -1 : left.catalogId > right.catalogId ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return right.isFile() && !right.isSymbolicLink() && left.dev === right.dev && left.ino === right.ino &&
    left.nlink === 1 && right.nlink === 1 && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function sameDirectoryIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return right.isDirectory() && !right.isSymbolicLink() && left.dev === right.dev && left.ino === right.ino;
}
