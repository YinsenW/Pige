import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PigeDomainError } from "@pige/domain";
import {
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  OperationRecordSchema,
  type DatasetManifest,
  type DatasetRevision,
  type DatasetSchemaRecord,
  type OperationRecord
} from "@pige/schemas";
import { createVaultRelativePathResolver } from "./vault-layout";

export interface FileRef {
  readonly path: string;
  readonly checksum: string;
  readonly size: number;
}

export interface BundleBinding {
  readonly vaultPath: string;
  readonly bundlePath: string;
  readonly bundleRelativePath: string;
  readonly manifestPath: string;
  readonly manifestBytes: Buffer;
  readonly manifestStat: fs.Stats;
  readonly manifest: DatasetManifest;
  readonly revision: DatasetRevision;
  readonly schema: DatasetSchemaRecord;
  readonly payloadPath: string;
}

export const MAX_COLLECTION_JSON_BYTES = 512 * 1024;
const MAX_DATASET_ENTRIES = 10_000;
const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
const OPERATION_ID = /^op_(\d{8})_[a-z0-9]{8,}$/u;

export function readBundle(vaultPath: string, datasetId: string): BundleBinding | undefined {
  return readAllBundles(vaultPath).find((binding) => binding.manifest.datasetId === datasetId);
}

export function readAllBundles(vaultPath: string): BundleBinding[] {
  assertSafeVaultRoot(vaultPath);
  const datasetsRoot = resolveVaultRelativePath(vaultPath, "datasets");
  if (!fs.existsSync(datasetsRoot)) return [];
  assertSafeDirectory(vaultPath, datasetsRoot);
  const entries = fs.readdirSync(datasetsRoot, { withFileTypes: true });
  if (entries.length > MAX_DATASET_ENTRIES) {
    throw new PigeDomainError("collection.limit", "The Dataset directory is too large.");
  }
  const result: BundleBinding[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const bundlePath = path.join(datasetsRoot, entry.name);
    assertSafeDirectory(vaultPath, bundlePath);
    const manifestPath = path.join(bundlePath, "dataset.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifestFile = readRegularFile(manifestPath, MAX_COLLECTION_JSON_BYTES, bundlePath);
    const manifest = DatasetManifestSchema.parse(JSON.parse(manifestFile.bytes.toString("utf8")));
    const revision = DatasetRevisionSchema.parse(readJsonRef(bundlePath, manifest.revision));
    const schema = DatasetSchemaRecordSchema.parse(readJsonRef(bundlePath, manifest.schema));
    assertFileRef(bundlePath, manifest.payload);
    assertFileRef(bundlePath, revision.schema);
    assertFileRef(bundlePath, revision.payload);
    if (
      manifest.profile !== "managed_collection" ||
      manifest.activeRevision !== revision.id ||
      manifest.datasetId !== revision.datasetId ||
      manifest.datasetId !== schema.datasetId ||
      revision.id !== schema.revisionId ||
      hashCanonical(manifest.schema) !== hashCanonical(revision.schema) ||
      hashCanonical(manifest.payload) !== hashCanonical(revision.payload)
    ) throw new PigeDomainError("collection.revision_invalid", "The Collection revision binding is invalid.");
    result.push({
      vaultPath,
      bundlePath,
      bundleRelativePath: path.posix.join("datasets", entry.name),
      manifestPath,
      manifestBytes: manifestFile.bytes,
      manifestStat: manifestFile.stat,
      manifest,
      revision,
      schema,
      payloadPath: resolveBundleRelativePath(bundlePath, manifest.payload.path)
    });
  }
  if (new Set(result.map((binding) => binding.manifest.datasetId)).size !== result.length) {
    throw new PigeDomainError("collection.identity_conflict", "Dataset identities are not unique.");
  }
  return result;
}

export function readRevisionById(binding: BundleBinding, revisionId: string): DatasetRevision {
  const revisionPath = resolveBundleRelativePath(binding.bundlePath, `revisions/${revisionId}.json`);
  if (!fs.existsSync(revisionPath)) throw operationConflict();
  const revision = DatasetRevisionSchema.parse(readJsonBounded(revisionPath, MAX_COLLECTION_JSON_BYTES));
  if (revision.id !== revisionId || revision.datasetId !== binding.manifest.datasetId) throw operationConflict();
  assertFileRef(binding.bundlePath, revision.schema);
  assertFileRef(binding.bundlePath, revision.payload);
  return revision;
}

export function replaceManifestCas(binding: BundleBinding, next: DatasetManifest): void {
  const current = readRegularFile(binding.manifestPath, MAX_COLLECTION_JSON_BYTES, binding.bundlePath);
  if (!current.bytes.equals(binding.manifestBytes) || !sameFileRevision(current.stat, binding.manifestStat)) {
    throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before commit.");
  }
  const temporaryPath = `${binding.manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    syncFile(temporaryPath);
    const verify = readRegularFile(binding.manifestPath, MAX_COLLECTION_JSON_BYTES, binding.bundlePath);
    if (!verify.bytes.equals(binding.manifestBytes) || !sameFileRevision(verify.stat, binding.manifestStat)) {
      throw new PigeDomainError("collection.revision_changed", "The Collection manifest changed before publication.");
    }
    fs.renameSync(temporaryPath, binding.manifestPath);
    syncDirectory(path.dirname(binding.manifestPath));
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function publishImmutableFile(stagedPath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    fs.linkSync(stagedPath, destinationPath);
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (checksumFile(stagedPath) !== checksumFile(destinationPath)) throw requestConflict();
    return;
  }
  syncDirectory(path.dirname(destinationPath));
}

export function writeJsonImmutable(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (!readRegularFile(filePath, MAX_COLLECTION_JSON_BYTES, path.dirname(filePath)).bytes.equals(bytes)) {
      throw requestConflict();
    }
  }
}

export function writeJsonExclusive(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const expected = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.writeFileSync(filePath, expected, { flag: "wx", mode: 0o600 });
    syncFile(filePath);
    syncDirectory(path.dirname(filePath));
  } catch (caught) {
    if (!isErrno(caught, "EEXIST")) throw caught;
    if (!readRegularFile(filePath, MAX_COLLECTION_JSON_BYTES, path.dirname(filePath)).bytes.equals(expected)) {
      throw operationConflict();
    }
  }
}

export function operationPathFor(vaultPath: string, operationId: string): string {
  const dateKey = OPERATION_ID.exec(operationId)?.[1];
  if (!dateKey) throw operationConflict();
  return resolveVaultRelativePath(
    vaultPath,
    `.pige/operations/${dateKey.slice(0, 4)}/${dateKey.slice(4, 6)}/${operationId}.json`
  );
}

export function readOperationRecords(vaultPath: string): OperationRecord[] {
  const root = resolveVaultRelativePath(vaultPath, ".pige/operations");
  if (!fs.existsSync(root)) return [];
  const result: OperationRecord[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (++seen > MAX_DATASET_ENTRIES) {
        throw new PigeDomainError("collection.limit", "The Operation store is too large.");
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          result.push(OperationRecordSchema.parse(readJsonBounded(absolute, MAX_COLLECTION_JSON_BYTES)));
        } catch {
          // The Activity owner reports malformed records; recovery ignores them.
        }
      }
    }
  }
  return result;
}

export function openReadOnlyPayload(filePath: string): DatabaseSync {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PAYLOAD_BYTES) throw payloadInvalid();
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    database.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;");
    validatePayloadSchema(database);
    return database;
  } catch (caught) {
    database.close();
    throw caught;
  }
}

function validatePayloadSchema(database: DatabaseSync): void {
  const expectedTables = new Set([
    "pige_dataset_meta",
    "pige_dataset_tables",
    "pige_dataset_columns",
    "pige_dataset_rows",
    "pige_dataset_cells"
  ]);
  const expectedIndexes = new Set([
    "sqlite_autoindex_pige_dataset_meta_1",
    "sqlite_autoindex_pige_dataset_tables_1",
    "sqlite_autoindex_pige_dataset_columns_1",
    "sqlite_autoindex_pige_dataset_columns_2",
    "sqlite_autoindex_pige_dataset_rows_1",
    "sqlite_autoindex_pige_dataset_rows_2",
    "sqlite_autoindex_pige_dataset_cells_1"
  ]);
  const objects = database.prepare(
    "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' OR name LIKE 'sqlite_autoindex_pige_dataset_%'"
  ).all() as Array<{ type?: unknown; name?: unknown }>;
  for (const object of objects) {
    if (typeof object.type !== "string" || typeof object.name !== "string") throw payloadInvalid();
    if (object.type === "table" && expectedTables.delete(object.name)) continue;
    if (object.type === "index" && expectedIndexes.delete(object.name)) continue;
    throw payloadInvalid();
  }
  if (expectedTables.size !== 0 || expectedIndexes.size !== 0) throw payloadInvalid();
}

export function validatePayloadMeta(database: DatabaseSync, datasetId?: string, revisionId?: string): void {
  validatePayloadSchema(database);
  const rows = database.prepare("SELECT key, value FROM pige_dataset_meta").all() as Array<{
    key?: unknown;
    value?: unknown;
  }>;
  const meta = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key !== "string" || typeof row.value !== "string" || meta.has(row.key)) throw payloadInvalid();
    meta.set(row.key, row.value);
  }
  if (
    meta.get("format") !== "pige-managed-collection-v1" ||
    (datasetId !== undefined && meta.get("dataset_id") !== datasetId) ||
    (revisionId !== undefined && meta.get("revision_id") !== revisionId)
  ) throw payloadInvalid();
}

export function readJsonRef(bundlePath: string, ref: FileRef): unknown {
  assertFileRef(bundlePath, ref);
  return readJsonBounded(resolveBundleRelativePath(bundlePath, ref.path), MAX_COLLECTION_JSON_BYTES);
}

export function assertFileRef(bundlePath: string, ref: FileRef): void {
  const filePath = resolveBundleRelativePath(bundlePath, ref.path);
  const file = readRegularFile(
    filePath,
    Math.max(MAX_COLLECTION_JSON_BYTES, Math.min(MAX_PAYLOAD_BYTES, ref.size)),
    bundlePath
  );
  if (file.stat.size !== ref.size || hashBytes(file.bytes) !== ref.checksum) {
    throw new PigeDomainError("collection.file_changed", "A Collection file failed integrity validation.");
  }
}

export function fileRef(bundlePath: string, relativePath: string): FileRef {
  const filePath = resolveBundleRelativePath(bundlePath, relativePath);
  const stat = fs.lstatSync(filePath);
  return { path: relativePath, checksum: checksumFile(filePath), size: stat.size };
}

function readRegularFile(
  filePath: string,
  maximumBytes: number,
  confinementRoot: string
): { readonly bytes: Buffer; readonly stat: fs.Stats } {
  const resolvedRoot = fs.realpathSync(confinementRoot);
  const resolvedParent = fs.realpathSync(path.dirname(filePath));
  const relativeParent = path.relative(resolvedRoot, resolvedParent);
  if (relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) {
    throw payloadInvalid();
  }
  const descriptor = fs.openSync(filePath, noFollowFlag());
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 0 || stat.size > maximumBytes) throw payloadInvalid();
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw payloadInvalid();
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (!sameFileRevision(stat, after)) throw payloadInvalid();
    return { bytes, stat: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readJsonBounded(filePath: string, maximumBytes: number): unknown {
  return JSON.parse(readRegularFile(filePath, maximumBytes, path.dirname(filePath)).bytes.toString("utf8"));
}

export function resolveBundleRelativePath(bundlePath: string, relativePath: string): string {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) throw payloadInvalid();
  const resolved = path.resolve(bundlePath, ...relativePath.split("/"));
  const relative = path.relative(path.resolve(bundlePath), resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw payloadInvalid();
  return resolved;
}

export function assertSafeVaultRoot(vaultPath: string): void {
  const stat = fs.lstatSync(vaultPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PigeDomainError("collection.path_unsafe", "The active vault root is unsafe.");
  }
}

function assertSafeDirectory(vaultPath: string, directoryPath: string): void {
  const stat = fs.lstatSync(directoryPath);
  const relative = path.relative(fs.realpathSync(vaultPath), fs.realpathSync(directoryPath));
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) throw payloadInvalid();
}

function sameFileRevision(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export function hashCanonical(value: unknown): string {
  return hashBytes(Buffer.from(stableStringify(value), "utf8"));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function checksumFile(filePath: string): string {
  return hashBytes(fs.readFileSync(filePath));
}

export function syncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function syncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (caught) {
    if (!isErrno(caught, "EINVAL") && !isErrno(caught, "ENOTSUP") && !isErrno(caught, "EBADF")) throw caught;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function noFollowFlag(): number {
  return fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
}

function isErrno(value: unknown, code: string): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value && (value as NodeJS.ErrnoException).code === code;
}

export function payloadInvalid(): PigeDomainError {
  return new PigeDomainError("collection.payload_invalid", "The Collection payload is invalid.");
}

export function requestConflict(): PigeDomainError {
  return new PigeDomainError("collection.request_conflict", "The Collection request identity was reused with different input.");
}

export function operationConflict(): PigeDomainError {
  return new PigeDomainError("collection.operation_conflict", "The Collection Operation is inconsistent.");
}

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("collection.path_unsafe", "A Collection path escapes the active vault."),
  { allowVaultRoot: false }
);
