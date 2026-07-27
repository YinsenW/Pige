import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SQLITE_VECTOR_DIMENSION,
  SqliteVectorIndexDriver,
  createPackagedSqliteVectorIndexDriver,
  type SqliteVectorIndexMetadata,
  type SqliteVectorOperations
} from "../../apps/desktop/src/main/services/sqlite-vector-index-driver";

const roots: string[] = [];
const metadata: SqliteVectorIndexMetadata = {
  schemaVersion: 1,
  modelAssetId: "qwen3_embedding_0_6b_q8_0",
  modelAssetRevision: "c2602621d50895a7b8277ddd4a8c31e699c9d002",
  dimension: SQLITE_VECTOR_DIMENSION,
  chunkerVersion: "rag_chunker_v1",
  sourceIndexGeneration: "index_generation_7"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("SqliteVectorIndexDriver", () => {
  it("loads the exact extension once per database and immediately disables further loading", () => {
    const { vaultRoot, vectorRoot: root } = tempPaths();
    const extensionPath = path.join(vaultRoot, "sqlite-vec-0.1.9.dylib");
    fs.writeFileSync(extensionPath, "test seam");
    const opened: DatabaseSync[] = [];
    const load = vi.fn((database: DatabaseSync, exactPath: string) => {
      expect(exactPath).toBe(extensionPath);
      opened.push(database);
      return {
        ...testVectorOperations,
        create: (target: DatabaseSync) => {
          expect(() => target.loadExtension(extensionPath)).toThrow();
          testVectorOperations.create(target);
        }
      };
    });
    const driver = new SqliteVectorIndexDriver({ rootPath: root, exactExtensionPath: extensionPath, loadExtension: load });

    expect(driver.rebuild({ metadata, entries: [{ chunkId: "chunk:a", vector: unitVector(0) }] }))
      .toEqual({ status: "ready", count: 1 });
    expect(load).toHaveBeenCalledTimes(opened.length);
    expect(new Set(opened).size).toBe(opened.length);
  });

  it("resolves the production extension only from packaged getLoadablePath", async () => {
    const { vaultRoot, vectorRoot } = tempPaths();
    const extensionPath = path.join(vaultRoot, "sqlite-vec-0.1.9.dylib");
    fs.writeFileSync(extensionPath, "test seam");
    const getLoadablePath = vi.fn(() => extensionPath);
    const activateExtension = vi.fn(() => testVectorOperations);
    const driver = await createPackagedSqliteVectorIndexDriver(
      { rootPath: vectorRoot },
      {
        importModule: async () => ({ getLoadablePath }),
        activateExtension
      }
    );

    expect(driver.rebuild({ metadata, entries: [{ chunkId: "chunk:a", vector: unitVector(0) }] }))
      .toEqual({ status: "ready", count: 1 });
    expect(getLoadablePath).toHaveBeenCalledTimes(1);
    expect(activateExtension).toHaveBeenCalled();
    expect(activateExtension.mock.calls.every((call) => call[1] === extensionPath)).toBe(true);

    const linkedPath = path.join(vaultRoot, "linked-sqlite-vec.dylib");
    fs.symlinkSync(extensionPath, linkedPath);
    await expect(createPackagedSqliteVectorIndexDriver(
      { rootPath: vectorRoot },
      { importModule: async () => ({ getLoadablePath: () => linkedPath }) }
    )).rejects.toThrow("canonical regular file");
  });

  it("atomically replaces a staged index and returns deterministic distance and chunk ordering", () => {
    const { driver, root } = harness();
    expect(driver.rebuild({
      metadata,
      entries: [
        { chunkId: "chunk:z", vector: unitVector(1) },
        { chunkId: "chunk:b", vector: unitVector(0) },
        { chunkId: "chunk:a", vector: unitVector(0) }
      ]
    })).toEqual({ status: "ready", count: 3 });

    expect(driver.search({ metadata, queryVector: unitVector(0), k: 3 })).toEqual({
      status: "ready",
      matches: [
        { chunkId: "chunk:a", distance: 0 },
        { chunkId: "chunk:b", distance: 0 },
        { chunkId: "chunk:z", distance: Math.SQRT2 }
      ]
    });
    expect(fs.readdirSync(root).filter((name) => name.includes(".staging."))).toEqual([]);

    const originalRename = fs.renameSync.bind(fs);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (String(source).includes(".staging.") && destination === path.join(root, "semantic-vectors.sqlite")) {
        throw new Error("synthetic Windows replacement failure");
      }
      return originalRename(source, destination);
    });
    expect(driver.rebuild({
      metadata: { ...metadata, sourceIndexGeneration: "index_generation_swap_failure" },
      entries: [{ chunkId: "chunk:swap-failed", vector: unitVector(2) }]
    })).toEqual({ status: "unavailable" });
    rename.mockRestore();
    expect(driver.readCurrent(metadata)).toEqual({ status: "ready", count: 3 });
    expect(fs.readdirSync(root).filter((name) => name.includes(".backup.") || name.includes(".staging.")))
      .toEqual([]);

    const failedReplacement = new SqliteVectorIndexDriver({
      rootPath: root,
      exactExtensionPath: path.join(path.dirname(path.dirname(path.dirname(root))), "sqlite-vec-0.1.9.dylib"),
      loadExtension: () => ({
        ...testVectorOperations,
        insert: () => { throw new Error("synthetic staging failure"); }
      })
    });
    expect(failedReplacement.rebuild({
      metadata: { ...metadata, sourceIndexGeneration: "index_generation_failed" },
      entries: [{ chunkId: "chunk:failed", vector: unitVector(2) }]
    })).toEqual({ status: "unavailable" });
    expect(driver.readCurrent(metadata)).toEqual({ status: "ready", count: 3 });
    expect(fs.readdirSync(root).filter((name) => name.includes(".staging."))).toEqual([]);

    expect(driver.rebuild({
      metadata: { ...metadata, sourceIndexGeneration: "index_generation_8" },
      entries: [{ chunkId: "chunk:new", vector: unitVector(2) }]
    })).toEqual({ status: "ready", count: 1 });
    expect(driver.readCurrent(metadata)).toEqual({ status: "unavailable" });
  });

  it("rejects roots and database paths that escape canonical private confinement", () => {
    const { vaultRoot, vectorRoot } = tempPaths();
    const extensionPath = path.join(vaultRoot, "sqlite-vec-0.1.9.dylib");
    fs.writeFileSync(extensionPath, "test seam");
    expect(() => new SqliteVectorIndexDriver({
      rootPath: path.join(vaultRoot, "vectors"),
      exactExtensionPath: extensionPath,
      loadExtension: () => testVectorOperations
    })).toThrow(".pige/indexes/vectors");

    const linkedVault = canonicalTempRoot();
    const linkedTarget = path.join(linkedVault, "target");
    fs.mkdirSync(path.join(linkedTarget, "indexes", "vectors"), { recursive: true });
    fs.symlinkSync(linkedTarget, path.join(linkedVault, ".pige"));
    expect(() => new SqliteVectorIndexDriver({
      rootPath: path.join(linkedVault, ".pige", "indexes", "vectors"),
      exactExtensionPath: extensionPath,
      loadExtension: () => testVectorOperations
    })).toThrow("non-symlink directory");

    const driver = new SqliteVectorIndexDriver({
      rootPath: vectorRoot,
      exactExtensionPath: extensionPath,
      loadExtension: () => testVectorOperations
    });
    const outside = path.join(vaultRoot, "outside.sqlite");
    fs.writeFileSync(outside, "outside sentinel");
    fs.symlinkSync(outside, path.join(vectorRoot, "semantic-vectors.sqlite"));
    expect(driver.readCurrent(metadata)).toEqual({ status: "unavailable" });
    expect(driver.rebuild({ metadata, entries: [{ chunkId: "chunk:a", vector: unitVector(0) }] }))
      .toEqual({ status: "unavailable" });
    expect(fs.readFileSync(outside, "utf8")).toBe("outside sentinel");
  });

  it("returns unavailable for missing, mismatched, or corrupt current indexes", () => {
    const { driver, root } = harness();
    expect(driver.readCurrent(metadata)).toEqual({ status: "unavailable" });
    expect(driver.rebuild({ metadata, entries: [{ chunkId: "chunk:a", vector: unitVector(0) }] }))
      .toEqual({ status: "ready", count: 1 });
    expect(driver.readCurrent({ ...metadata, modelAssetRevision: "different_revision" }))
      .toEqual({ status: "unavailable" });

    fs.writeFileSync(path.join(root, "semantic-vectors.sqlite"), "not sqlite");
    expect(driver.search({ metadata, queryVector: unitVector(0), k: 1 }))
      .toEqual({ status: "unavailable" });
  });

  it("enforces exact finite vectors, normalized queries, bounded k, and unique chunk identities", () => {
    const { driver } = harness();
    expect(() => driver.rebuild({
      metadata,
      entries: [{ chunkId: "chunk:a", vector: Array(SQLITE_VECTOR_DIMENSION - 1).fill(0) }]
    })).toThrow("1024 finite");
    expect(() => driver.rebuild({
      metadata,
      entries: [{ chunkId: "chunk:a", vector: [...unitVector(0).slice(0, -1), Number.NaN] }]
    })).toThrow("1024 finite");
    expect(() => driver.rebuild({
      metadata,
      entries: [{ chunkId: "chunk:a", vector: [Number.MAX_VALUE, ...unitVector(0).slice(1)] }]
    })).toThrow("1024 finite");
    expect(() => driver.rebuild({
      metadata,
      entries: [
        { chunkId: "chunk:a", vector: unitVector(0) },
        { chunkId: "chunk:a", vector: unitVector(1) }
      ]
    })).toThrow("unique");
    expect(() => driver.search({ metadata, queryVector: Array(SQLITE_VECTOR_DIMENSION).fill(1), k: 1 }))
      .toThrow("normalized");
    expect(() => driver.search({ metadata, queryVector: unitVector(0), k: 65 }))
      .toThrow("between 1 and 64");
  });

  it("streams multiple bounded batches with stable sequential BigInt rowids", () => {
    const rowids: bigint[] = [];
    const operations: SqliteVectorOperations = {
      ...testVectorOperations,
      insert: (database, rowid, vector) => {
        rowids.push(rowid);
        testVectorOperations.insert(database, rowid, vector);
      }
    };
    const { driver } = harness(operations);
    const session = driver.beginRebuild(metadata);
    session.append([
      { chunkId: "chunk:a", vector: unitVector(0) },
      { chunkId: "chunk:b", vector: unitVector(1) }
    ]);
    session.append([{ chunkId: "chunk:c", vector: unitVector(2) }]);

    expect(session.commit()).toEqual({ status: "ready", count: 3 });
    expect(rowids).toEqual([1n, 2n, 3n]);
    expect(driver.search({ metadata, queryVector: unitVector(1), k: 3 })).toEqual({
      status: "ready",
      matches: [
        { chunkId: "chunk:b", distance: 0 },
        { chunkId: "chunk:a", distance: Math.SQRT2 },
        { chunkId: "chunk:c", distance: Math.SQRT2 }
      ]
    });
  });

  it("rejects duplicate streamed chunks and abort or dispose preserves the current index", () => {
    const { driver, root } = harness();
    expect(driver.rebuild({ metadata, entries: [{ chunkId: "chunk:current", vector: unitVector(0) }] }))
      .toEqual({ status: "ready", count: 1 });

    const duplicate = driver.beginRebuild({ ...metadata, sourceIndexGeneration: "index_generation_duplicate" });
    duplicate.append([{ chunkId: "chunk:new", vector: unitVector(1) }]);
    expect(() => duplicate.append([{ chunkId: "chunk:new", vector: unitVector(2) }]))
      .toThrow("unique");
    expect(() => duplicate.commit()).toThrow("no longer active");
    expect(driver.readCurrent(metadata)).toEqual({ status: "ready", count: 1 });

    const aborted = driver.beginRebuild({ ...metadata, sourceIndexGeneration: "index_generation_abort" });
    expect(() => aborted.append(Array.from({ length: 17 }, (_, index) => ({
      chunkId: `chunk:batch:${index}`,
      vector: unitVector(index)
    })))).toThrow("between 1 and 16");
    aborted.append([{ chunkId: "chunk:discarded", vector: unitVector(3) }]);
    aborted.dispose();
    aborted.abort();
    expect(driver.readCurrent(metadata)).toEqual({ status: "ready", count: 1 });
    expect(fs.readdirSync(root).filter((name) => name.includes(".staging."))).toEqual([]);
  });
});

function harness(
  operations: SqliteVectorOperations = testVectorOperations
): { driver: SqliteVectorIndexDriver; root: string } {
  const { vaultRoot, vectorRoot: root } = tempPaths();
  const extensionPath = path.join(vaultRoot, "sqlite-vec-0.1.9.dylib");
  fs.writeFileSync(extensionPath, "test seam");
  return {
    root,
    driver: new SqliteVectorIndexDriver({
      rootPath: root,
      exactExtensionPath: extensionPath,
      loadExtension: () => operations
    })
  };
}

function tempPaths(): { vaultRoot: string; vectorRoot: string } {
  const vaultRoot = canonicalTempRoot();
  const vectorRoot = path.join(vaultRoot, ".pige", "indexes", "vectors");
  fs.mkdirSync(vectorRoot, { recursive: true });
  return { vaultRoot, vectorRoot };
}

function canonicalTempRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pige-vector-index-")));
  roots.push(root);
  return root;
}

function unitVector(index: number): readonly number[] {
  return Array.from({ length: SQLITE_VECTOR_DIMENSION }, (_, current) => current === index ? 1 : 0);
}

const testVectorOperations: SqliteVectorOperations = {
  create: (database) => {
    database.exec("CREATE TABLE vector_entries(rowid INTEGER PRIMARY KEY, vector_json TEXT NOT NULL)");
  },
  insert: (database, rowid, vector) => {
    if (typeof rowid !== "bigint") throw new Error("vector rowid must remain bigint");
    database.prepare("INSERT INTO vector_entries(rowid, vector_json) VALUES (?, ?)")
      .run(rowid, JSON.stringify(vector));
  },
  count: (database) => {
    const count = database.prepare("SELECT COUNT(*) AS count FROM vector_entries").get()?.count;
    if (typeof count !== "number") throw new Error("invalid count");
    return count;
  },
  search: (database, queryVector, limit) => {
    const statement = database.prepare("SELECT rowid, vector_json FROM vector_entries");
    statement.setReadBigInts(true);
    return statement.all().map((row) => {
      if (typeof row.rowid !== "bigint" || typeof row.vector_json !== "string") {
        throw new Error("invalid vector row");
      }
      const vector = JSON.parse(row.vector_json) as number[];
      const distance = Math.sqrt(vector.reduce((sum, value, index) => {
        const delta = value - (queryVector[index] ?? 0);
        return sum + delta * delta;
      }, 0));
      return { rowid: row.rowid, distance };
    }).sort((left, right) => left.distance - right.distance).slice(0, limit);
  }
};
