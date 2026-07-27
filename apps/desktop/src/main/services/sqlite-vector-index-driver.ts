import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const SQLITE_VECTOR_DIMENSION = 1024 as const;
const VECTOR_INDEX_SCHEMA_VERSION = 1 as const;
const DATABASE_NAME = "semantic-vectors.sqlite";
const VECTOR_ROOT_SEGMENTS = [".pige", "indexes", "vectors"] as const;
const SQLITE_VEC_PACKAGE_NAME: string = "sqlite-vec";
const MAX_REBUILD_BATCH_SIZE = 16;
const MAX_CHUNK_ID_LENGTH = 192;
const MAX_ROWID = 9_007_199_254_740_991n;

export interface SqliteVectorIndexMetadata {
  readonly schemaVersion: typeof VECTOR_INDEX_SCHEMA_VERSION;
  readonly modelAssetId: string;
  readonly modelAssetRevision: string;
  readonly dimension: typeof SQLITE_VECTOR_DIMENSION;
  readonly chunkerVersion: string;
  readonly sourceIndexGeneration: string;
}

export interface SqliteVectorIndexEntry {
  readonly chunkId: string;
  readonly vector: readonly number[];
}

export interface SqliteVectorSearchMatch {
  readonly chunkId: string;
  readonly distance: number;
}

export type SqliteVectorIndexReadResult =
  | { readonly status: "ready"; readonly count: number }
  | { readonly status: "unavailable" };

export type SqliteVectorSearchResult =
  | { readonly status: "ready"; readonly matches: readonly SqliteVectorSearchMatch[] }
  | { readonly status: "unavailable" };

export interface SqliteVectorOperations {
  readonly create: (database: DatabaseSync) => void;
  readonly insert: (database: DatabaseSync, rowid: bigint, vector: readonly number[]) => void;
  readonly count: (database: DatabaseSync) => number;
  readonly search: (
    database: DatabaseSync,
    queryVector: readonly number[],
    limit: number
  ) => readonly { readonly rowid: bigint; readonly distance: number }[];
}

export type SqliteVectorExtensionLoader = (
  database: DatabaseSync,
  exactExtensionPath: string
) => SqliteVectorOperations;

export interface SqliteVectorIndexDriverOptions {
  readonly rootPath: string;
  readonly exactExtensionPath: string;
  readonly loadExtension: SqliteVectorExtensionLoader;
  readonly createDatabase?: (filePath: string) => DatabaseSync;
}

interface PackagedSqliteVecModule {
  readonly getLoadablePath: () => string;
}

interface PackagedSqliteVectorIndexTestSeams {
  readonly importModule?: () => Promise<unknown>;
  readonly activateExtension?: SqliteVectorExtensionLoader;
}

export async function createPackagedSqliteVectorIndexDriver(
  options: { readonly rootPath: string },
  testSeams: PackagedSqliteVectorIndexTestSeams = {}
): Promise<SqliteVectorIndexDriver> {
  const imported = await (testSeams.importModule ?? importPackagedSqliteVec)();
  const packaged = parsePackagedSqliteVecModule(imported);
  const exactExtensionPath = canonicalRegularFile(
    packaged.getLoadablePath(),
    "Packaged SQLite vector extension"
  );
  const activate = testSeams.activateExtension ?? activateNativeSqliteVec;
  return new SqliteVectorIndexDriver({
    rootPath: options.rootPath,
    exactExtensionPath,
    loadExtension: (database, candidatePath) => {
      if (candidatePath !== exactExtensionPath) {
        throw new Error("SQLite vector extension identity changed.");
      }
      return activate(database, exactExtensionPath);
    }
  });
}

export class SqliteVectorIndexDriver {
  readonly #rootPath: string;
  readonly #databasePath: string;
  readonly #exactExtensionPath: string;
  readonly #loadExtension: SqliteVectorExtensionLoader;
  readonly #createDatabase: (filePath: string) => DatabaseSync;

  constructor(options: SqliteVectorIndexDriverOptions) {
    this.#rootPath = ensureCanonicalVectorRoot(options.rootPath);
    this.#databasePath = path.join(this.#rootPath, DATABASE_NAME);
    this.#exactExtensionPath = canonicalRegularFile(
      options.exactExtensionPath,
      "SQLite vector extension"
    );
    this.#loadExtension = options.loadExtension;
    this.#createDatabase = options.createDatabase ?? ((filePath) => new DatabaseSync(filePath, {
      allowExtension: true
    }));
  }

  rebuild(input: {
    readonly metadata: SqliteVectorIndexMetadata;
    readonly entries: readonly SqliteVectorIndexEntry[];
  }): SqliteVectorIndexReadResult {
    validateCompatibilityEntries(input.entries);
    let session: SqliteVectorRebuildSession | undefined;
    try {
      session = this.beginRebuild(input.metadata);
      for (let index = 0; index < input.entries.length; index += MAX_REBUILD_BATCH_SIZE) {
        session.append(input.entries.slice(index, index + MAX_REBUILD_BATCH_SIZE));
      }
      return session.commit();
    } catch {
      session?.abort();
      return { status: "unavailable" };
    }
  }

  beginRebuild(metadataInput: SqliteVectorIndexMetadata): SqliteVectorRebuildSession {
    const metadata = validateMetadata(metadataInput);
    assertCanonicalVectorRoot(this.#rootPath);
    assertCurrentDatabaseSafe(this.#databasePath, this.#rootPath);
    const stagingPath = path.join(this.#rootPath, `.${DATABASE_NAME}.staging.${randomUUID()}`);
    let database: DatabaseSync | undefined;
    try {
      database = this.#open(stagingPath);
      configureWritableDatabase(database);
      createBaseSchema(database);
      const operations = vectorOperations(database);
      operations.create(database);
      database.exec("BEGIN IMMEDIATE");
      writeMetadata(database, metadata);
      const session = new SqliteVectorRebuildSession({
        database,
        operations,
        metadata,
        stagingPath,
        currentPath: this.#databasePath,
        rootPath: this.#rootPath,
        readPublished: () => this.readCurrent(metadata)
      });
      database = undefined;
      return session;
    } catch (error) {
      try { database?.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
      try { database?.close(); } catch { /* best-effort close */ }
      try { fs.rmSync(stagingPath, { force: true }); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }

  readCurrent(expectedMetadata: SqliteVectorIndexMetadata): SqliteVectorIndexReadResult {
    const metadata = validateMetadata(expectedMetadata);
    let database: DatabaseSync | undefined;
    try {
      assertCanonicalVectorRoot(this.#rootPath);
      if (!fs.existsSync(this.#databasePath)) return { status: "unavailable" };
      assertRegularFileInRoot(this.#databasePath, this.#rootPath);
      database = this.#open(this.#databasePath);
      configureReadDatabase(database);
      const count = readMappedCount(database);
      validateOpenIndex(database, metadata, count);
      return { status: "ready", count };
    } catch {
      return { status: "unavailable" };
    } finally {
      try { database?.close(); } catch { /* best-effort close */ }
    }
  }

  search(input: {
    readonly metadata: SqliteVectorIndexMetadata;
    readonly queryVector: readonly number[];
    readonly k: number;
  }): SqliteVectorSearchResult {
    const metadata = validateMetadata(input.metadata);
    const queryVector = validateVector(input.queryVector, true);
    if (!Number.isInteger(input.k) || input.k < 1 || input.k > 64) {
      throw new Error("Vector search limit must be between 1 and 64.");
    }
    let database: DatabaseSync | undefined;
    try {
      assertCanonicalVectorRoot(this.#rootPath);
      if (!fs.existsSync(this.#databasePath)) return { status: "unavailable" };
      assertRegularFileInRoot(this.#databasePath, this.#rootPath);
      database = this.#open(this.#databasePath);
      configureReadDatabase(database);
      const count = readMappedCount(database);
      validateOpenIndex(database, metadata, count);
      const matches = mapSearchMatches(
        database,
        vectorOperations(database).search(database, queryVector, input.k),
        input.k
      );
      return { status: "ready", matches };
    } catch {
      return { status: "unavailable" };
    } finally {
      try { database?.close(); } catch { /* best-effort close */ }
    }
  }

  #open(filePath: string): DatabaseSync {
    const database = this.#createDatabase(filePath);
    let operations: SqliteVectorOperations;
    try {
      operations = this.#loadExtension(database, this.#exactExtensionPath);
      database.enableLoadExtension(false);
    } catch (error) {
      try { database.close(); } catch { /* best-effort close */ }
      throw error;
    }
    Object.defineProperty(database, VECTOR_OPERATIONS, { value: operations });
    return database;
  }
}

interface SqliteVectorRebuildSessionOptions {
  readonly database: DatabaseSync;
  readonly operations: SqliteVectorOperations;
  readonly metadata: SqliteVectorIndexMetadata;
  readonly stagingPath: string;
  readonly currentPath: string;
  readonly rootPath: string;
  readonly readPublished: () => SqliteVectorIndexReadResult;
}

export class SqliteVectorRebuildSession {
  readonly #database: DatabaseSync;
  readonly #operations: SqliteVectorOperations;
  readonly #metadata: SqliteVectorIndexMetadata;
  readonly #stagingPath: string;
  readonly #currentPath: string;
  readonly #rootPath: string;
  readonly #readPublished: () => SqliteVectorIndexReadResult;
  readonly #chunkIds = new Set<string>();
  #nextRowid = 1n;
  #count = 0;
  #probe: SqliteVectorIndexEntry | undefined;
  #active = true;

  constructor(options: SqliteVectorRebuildSessionOptions) {
    this.#database = options.database;
    this.#operations = options.operations;
    this.#metadata = options.metadata;
    this.#stagingPath = options.stagingPath;
    this.#currentPath = options.currentPath;
    this.#rootPath = options.rootPath;
    this.#readPublished = options.readPublished;
  }

  append(entries: readonly SqliteVectorIndexEntry[]): void {
    this.#assertActive();
    if (entries.length < 1 || entries.length > MAX_REBUILD_BATCH_SIZE) {
      throw new Error("Vector rebuild batches must contain between 1 and 16 entries.");
    }
    const batch = entries.map(validateEntry);
    const batchIds = new Set<string>();
    for (const entry of batch) {
      if (batchIds.has(entry.chunkId) || this.#chunkIds.has(entry.chunkId)) {
        this.abort();
        throw new Error("Vector chunk identities must be unique.");
      }
      batchIds.add(entry.chunkId);
    }

    try {
      const insertMapping = this.#database.prepare(
        "INSERT INTO vector_chunk_map(rowid, chunk_id) VALUES (?, ?)"
      );
      for (const entry of batch) {
        const rowid = this.#nextRowid;
        if (rowid > MAX_ROWID) throw new Error("Vector row mapping exceeded its bound.");
        insertMapping.run(rowid, entry.chunkId);
        this.#operations.insert(this.#database, rowid, entry.vector);
        this.#chunkIds.add(entry.chunkId);
        this.#probe ??= entry;
        this.#nextRowid += 1n;
        this.#count += 1;
      }
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  commit(): SqliteVectorIndexReadResult {
    this.#assertActive();
    try {
      this.#database.exec("COMMIT");
      validateOpenIndex(this.#database, this.#metadata, this.#count, this.#probe);
      this.#database.close();
      assertRegularFileInRoot(this.#stagingPath, this.#rootPath);
      fsyncFile(this.#stagingPath);
      replaceCurrentDatabase(this.#stagingPath, this.#currentPath, this.#rootPath);
      this.#active = false;
      return this.#readPublished();
    } catch (error) {
      this.#cleanup();
      throw error;
    }
  }

  abort(): void {
    if (!this.#active) return;
    this.#cleanup();
  }

  dispose(): void {
    this.abort();
  }

  #assertActive(): void {
    if (!this.#active) throw new Error("Vector rebuild session is no longer active.");
  }

  #cleanup(): void {
    if (!this.#active) return;
    this.#active = false;
    try { this.#database.exec("ROLLBACK"); } catch { /* committed or already rolled back */ }
    try { this.#database.close(); } catch { /* best-effort close */ }
    try { fs.rmSync(this.#stagingPath, { force: true }); } catch { /* best-effort cleanup */ }
  }
}

const VECTOR_OPERATIONS = Symbol("pige.sqliteVectorOperations");

function vectorOperations(database: DatabaseSync): SqliteVectorOperations {
  const operations = (database as DatabaseSync & {
    readonly [VECTOR_OPERATIONS]?: SqliteVectorOperations;
  })[VECTOR_OPERATIONS];
  if (!operations) throw new Error("SQLite vector extension was not initialized.");
  return operations;
}

function activateNativeSqliteVec(
  database: DatabaseSync,
  exactExtensionPath: string
): SqliteVectorOperations {
  database.loadExtension(exactExtensionPath);
  return nativeVectorOperations;
}

const nativeVectorOperations: SqliteVectorOperations = {
    create: (target) => {
      target.exec(
        `CREATE VIRTUAL TABLE vector_entries USING vec0(embedding float[${SQLITE_VECTOR_DIMENSION}])`
      );
    },
    insert: (target, rowid, vector) => {
      target.prepare("INSERT INTO vector_entries(rowid, embedding) VALUES (?, ?)")
        .run(rowid, new Float32Array(vector));
    },
    count: (target) => readCount(target, "SELECT COUNT(*) AS count FROM vector_entries"),
    search: (target, queryVector, limit) => {
      const statement = target.prepare(
        "SELECT rowid, distance FROM vector_entries WHERE embedding MATCH ? AND k = ?"
      );
      statement.setReadBigInts(true);
      return statement.all(new Float32Array(queryVector), limit).map((row) => ({
        rowid: requireBigInt(row.rowid),
        distance: requireFiniteNumber(row.distance)
      }));
    }
};

function configureWritableDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON");
}

function configureReadDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA query_only = ON; PRAGMA foreign_keys = ON");
}

function createBaseSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE vector_index_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL,
      model_asset_id TEXT NOT NULL,
      model_asset_revision TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      chunker_version TEXT NOT NULL,
      source_index_generation TEXT NOT NULL
    );
    CREATE TABLE vector_chunk_map (
      rowid INTEGER PRIMARY KEY,
      chunk_id TEXT NOT NULL UNIQUE
    );
  `);
}

function writeMetadata(database: DatabaseSync, metadata: SqliteVectorIndexMetadata): void {
  database.prepare(`
    INSERT INTO vector_index_metadata (
      singleton, schema_version, model_asset_id, model_asset_revision,
      dimension, chunker_version, source_index_generation
    ) VALUES (1, ?, ?, ?, ?, ?, ?)
  `).run(
    metadata.schemaVersion,
    metadata.modelAssetId,
    metadata.modelAssetRevision,
    metadata.dimension,
    metadata.chunkerVersion,
    metadata.sourceIndexGeneration
  );
}

function validateOpenIndex(
  database: DatabaseSync,
  expected: SqliteVectorIndexMetadata,
  expectedCount: number,
  probe?: SqliteVectorIndexEntry
): void {
  const row = database.prepare(`
    SELECT schema_version, model_asset_id, model_asset_revision, dimension,
           chunker_version, source_index_generation
    FROM vector_index_metadata WHERE singleton = 1
  `).get();
  if (!row ||
    row.schema_version !== expected.schemaVersion ||
    row.model_asset_id !== expected.modelAssetId ||
    row.model_asset_revision !== expected.modelAssetRevision ||
    row.dimension !== expected.dimension ||
    row.chunker_version !== expected.chunkerVersion ||
    row.source_index_generation !== expected.sourceIndexGeneration
  ) throw new Error("Vector index metadata mismatch.");

  const mappedCount = readMappedCount(database);
  const vectorCount = vectorOperations(database).count(database);
  if (mappedCount !== expectedCount || vectorCount !== expectedCount) {
    throw new Error("Vector index count mismatch.");
  }
  if (probe) {
    const result = mapSearchMatches(
      database,
      vectorOperations(database).search(database, probe.vector, 1),
      1
    );
    if (result.length !== 1 || result[0]?.chunkId !== probe.chunkId) {
      throw new Error("Vector index query validation failed.");
    }
  }
}

function mapSearchMatches(
  database: DatabaseSync,
  rows: readonly { readonly rowid: bigint; readonly distance: number }[],
  limit: number
): readonly SqliteVectorSearchMatch[] {
  const readChunk = database.prepare("SELECT chunk_id FROM vector_chunk_map WHERE rowid = ?");
  const matches = rows.map((row) => {
    if (row.rowid < 1n || row.rowid > MAX_ROWID) throw new Error("Invalid vector row identity.");
    const mapping = readChunk.get(row.rowid);
    if (!mapping || typeof mapping.chunk_id !== "string") {
      throw new Error("Missing vector chunk mapping.");
    }
    return { chunkId: validateChunkId(mapping.chunk_id), distance: requireFiniteNumber(row.distance) };
  });
  if (matches.length > limit) throw new Error("Vector search exceeded its requested bound.");
  return matches.sort((left, right) =>
    left.distance - right.distance || left.chunkId.localeCompare(right.chunkId)
  );
}

function readMappedCount(database: DatabaseSync): number {
  return readCount(database, "SELECT COUNT(*) AS count FROM vector_chunk_map");
}

function readCount(database: DatabaseSync, sql: string): number {
  const value = database.prepare(sql).get()?.count;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid vector index count.");
  }
  return value;
}

function validateCompatibilityEntries(entries: readonly SqliteVectorIndexEntry[]): void {
  const chunkIds = new Set<string>();
  for (const entry of entries) {
    const chunkId = validateChunkId(entry.chunkId);
    validateVector(entry.vector, false, false);
    if (chunkIds.has(chunkId)) throw new Error("Vector chunk identities must be unique.");
    chunkIds.add(chunkId);
  }
}

function validateEntry(entry: SqliteVectorIndexEntry): SqliteVectorIndexEntry {
  return {
    chunkId: validateChunkId(entry.chunkId),
    vector: validateVector(entry.vector, false)
  };
}

function validateMetadata(metadata: SqliteVectorIndexMetadata): SqliteVectorIndexMetadata {
  if (metadata.schemaVersion !== VECTOR_INDEX_SCHEMA_VERSION ||
    metadata.dimension !== SQLITE_VECTOR_DIMENSION ||
    !boundedIdentity(metadata.modelAssetId) ||
    !boundedIdentity(metadata.modelAssetRevision) ||
    !boundedIdentity(metadata.chunkerVersion) ||
    !boundedIdentity(metadata.sourceIndexGeneration)
  ) throw new Error("Invalid vector index metadata.");
  return { ...metadata };
}

function validateVector(
  vector: readonly number[],
  normalized: boolean,
  copy = true
): readonly number[] {
  if (vector.length !== SQLITE_VECTOR_DIMENSION ||
    vector.some((value) => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
    throw new Error("Vectors must contain exactly 1024 finite values.");
  }
  const validated = copy ? [...vector] : vector;
  if (normalized) {
    const magnitude = Math.sqrt(validated.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(magnitude) || Math.abs(magnitude - 1) > 1e-5) {
      throw new Error("Query vector must be normalized.");
    }
  }
  return validated;
}

function validateChunkId(chunkId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(chunkId) || chunkId.length > MAX_CHUNK_ID_LENGTH) {
    throw new Error("Invalid vector chunk identity.");
  }
  return chunkId;
}

function boundedIdentity(value: string): boolean {
  return value.length >= 1 && value.length <= 192 && /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value);
}

async function importPackagedSqliteVec(): Promise<unknown> {
  return import(SQLITE_VEC_PACKAGE_NAME);
}

function parsePackagedSqliteVecModule(value: unknown): PackagedSqliteVecModule {
  if (!value || typeof value !== "object" ||
    !("getLoadablePath" in value) || typeof value.getLoadablePath !== "function") {
    throw new Error("The reviewed sqlite-vec 0.1.9 package is unavailable.");
  }
  return { getLoadablePath: value.getLoadablePath.bind(value) as () => string };
}

function ensureCanonicalVectorRoot(rootPath: string): string {
  const requested = requireAbsolutePath(rootPath, "Vector index root");
  const vectors = path.basename(requested);
  const indexesPath = path.dirname(requested);
  const indexes = path.basename(indexesPath);
  const pigePath = path.dirname(indexesPath);
  const pige = path.basename(pigePath);
  if (vectors !== VECTOR_ROOT_SEGMENTS[2] ||
    indexes !== VECTOR_ROOT_SEGMENTS[1] || pige !== VECTOR_ROOT_SEGMENTS[0]) {
    throw new Error("Vector index root must be the private .pige/indexes/vectors directory.");
  }
  const vaultRoot = path.dirname(pigePath);
  assertCanonicalDirectory(vaultRoot, "Vault root");
  let current = vaultRoot;
  for (const segment of VECTOR_ROOT_SEGMENTS) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    assertCanonicalDirectory(current, "Vector index directory");
  }
  const canonical = fs.realpathSync(requested);
  if (canonical !== requested) throw new Error("Vector index root is not canonically confined.");
  return canonical;
}

function assertCanonicalVectorRoot(rootPath: string): void {
  assertCanonicalDirectory(rootPath, "Vector index root");
  const expectedSuffix = path.join(...VECTOR_ROOT_SEGMENTS);
  if (!rootPath.endsWith(`${path.sep}${expectedSuffix}`)) {
    throw new Error("Vector index root escaped its private owner.");
  }
}

function assertCanonicalDirectory(directoryPath: string, label: string): void {
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directoryPath) !== directoryPath) {
    throw new Error(`${label} must be a canonical non-symlink directory.`);
  }
}

function canonicalRegularFile(filePath: string, label: string): string {
  const requested = requireAbsolutePath(filePath, label);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(requested) !== requested) {
    throw new Error(`${label} must be a canonical regular file.`);
  }
  assertCanonicalDirectory(path.dirname(requested), `${label} parent`);
  return requested;
}

function assertCurrentDatabaseSafe(databasePath: string, rootPath: string): void {
  if (fs.existsSync(databasePath)) assertRegularFileInRoot(databasePath, rootPath);
}

function assertRegularFileInRoot(filePath: string, rootPath: string): void {
  const parent = fs.realpathSync(path.dirname(filePath));
  const stat = fs.lstatSync(filePath);
  if (parent !== rootPath || !stat.isFile() || stat.isSymbolicLink() ||
    fs.realpathSync(filePath) !== filePath) {
    throw new Error("Vector database path is not canonically confined.");
  }
}

function replaceCurrentDatabase(stagingPath: string, currentPath: string, rootPath: string): void {
  const backupPath = path.join(rootPath, `.${DATABASE_NAME}.backup.${randomUUID()}`);
  let currentBackedUp = false;
  let stagingPublished = false;
  try {
    if (fs.existsSync(currentPath)) {
      assertRegularFileInRoot(currentPath, rootPath);
      fs.renameSync(currentPath, backupPath);
      currentBackedUp = true;
      fsyncDirectory(rootPath);
    }
    fs.renameSync(stagingPath, currentPath);
    stagingPublished = true;
    assertRegularFileInRoot(currentPath, rootPath);
    fsyncDirectory(rootPath);
    if (currentBackedUp) {
      fs.rmSync(backupPath, { force: true });
      currentBackedUp = false;
      fsyncDirectory(rootPath);
    }
  } catch (error) {
    if (stagingPublished) {
      try { fs.rmSync(currentPath, { force: true }); } catch { /* best-effort rollback */ }
    }
    if (currentBackedUp) {
      try {
        fs.renameSync(backupPath, currentPath);
        currentBackedUp = false;
        fsyncDirectory(rootPath);
      } catch {
        // Leave the uniquely owned backup for deterministic startup recovery.
      }
    }
    throw error;
  } finally {
    if (!currentBackedUp) {
      try { fs.rmSync(backupPath, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
}

function requireAbsolutePath(value: string, label: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) {
    throw new Error(`${label} must be an absolute normalized path.`);
  }
  return value;
}

function requireBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new Error("Invalid vector row identity.");
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid vector distance.");
  }
  return value;
}

function fsyncFile(filePath: string): void {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directoryPath: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch {
    // Some supported filesystems do not permit directory fsync.
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
