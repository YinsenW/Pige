import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetManifestSchema, DatasetRevisionSchema, DatasetSchemaRecordSchema, JobRecordSchema, SourceRecordSchema } from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { planDatasetIngest } from "../../apps/desktop/src/main/services/dataset-ingest-core";
import { DatasetService, type DatasetImportPlanner } from "../../apps/desktop/src/main/services/dataset-service";
import {
  DATASET_INGEST_DEFAULT_LIMITS,
  type DatasetIngestPlan
} from "../../apps/desktop/src/main/services/dataset-ingest-types";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Dataset Service", () => {
  it("publishes the exact plan produced by the bounded Dataset ingest core", async () => {
    const fixture = await makeCsvFixture();
    const planner: DatasetImportPlanner = {
      isAvailable: () => true,
      plan: (filePath, sourceKind) => planDatasetIngest({
        requestId: "dataset-service-core-plan",
        filePath,
        sourceKind,
        limits: { ...DATASET_INGEST_DEFAULT_LIMITS }
      })
    };

    const result = await new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    );

    expect(result).toMatchObject({ created: true, tableCount: 1, rowCount: 2 });
  });

  it("publishes and reuses one validated managed Dataset Bundle for the same preserved source revision", async () => {
    const fixture = await makeCsvFixture();
    const plan = csvPlan(fixture.sourceBytes);
    const planner: DatasetImportPlanner = {
      isAvailable: () => true,
      plan: vi.fn(async () => plan)
    };
    const service = new DatasetService(planner);

    const first = await service.materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    );
    const currentSource = SourceRecordSchema.parse(JSON.parse(fs.readFileSync(fixture.sourceRecordPath, "utf8")));
    const second = await service.materializeSource(
      fixture.vaultPath,
      currentSource,
      fixture.sourceRecordPath,
      fixture.job
    );
    const laterJob = JobRecordSchema.parse({
      ...fixture.job,
      id: "job_20260713_dataset002",
      createdAt: "2026-07-13T02:00:00.000Z",
      updatedAt: "2026-07-13T02:00:00.000Z"
    });
    const third = await service.materializeSource(
      fixture.vaultPath,
      currentSource,
      fixture.sourceRecordPath,
      laterJob
    );

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      datasetId: first.datasetId,
      revisionId: first.revisionId,
      tableCount: 1,
      rowCount: 2,
      operationIds: first.operationIds
    });
    expect(third).toMatchObject({
      created: false,
      datasetId: first.datasetId,
      revisionId: first.revisionId,
      operationIds: first.operationIds
    });
    expect(planner.plan).toHaveBeenCalledTimes(1);

    const bundlePath = onlyEntryPath(path.join(fixture.vaultPath, "datasets"));
    const manifest = DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
    const revision = DatasetRevisionSchema.parse(readJson(path.join(bundlePath, manifest.revision.path)));
    const schema = DatasetSchemaRecordSchema.parse(readJson(path.join(bundlePath, manifest.schema.path)));
    expect(manifest).toMatchObject({
      datasetId: first.datasetId,
      activeRevision: first.revisionId,
      profile: "managed_collection"
    });
    expect(revision).toMatchObject({
      id: first.revisionId,
      stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4 }
    });
    expect(schema.tables[0]).toMatchObject({ name: "records", rowCount: 2, columnCount: 2 });
    expect(checksum(path.join(bundlePath, manifest.schema.path))).toBe(manifest.schema.checksum);
    expect(checksum(path.join(bundlePath, manifest.payload.path))).toBe(manifest.payload.checksum);

    const database = new DatabaseSync(path.join(bundlePath, manifest.payload.path), { readOnly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_rows").get()).toEqual({ count: 2 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM pige_dataset_cells").get()).toEqual({ count: 4 });
      expect(database.prepare("SELECT lexical_text FROM pige_dataset_cells WHERE lexical_text = ?").get("Ada"))
        .toEqual({ lexical_text: "Ada" });
    } finally {
      database.close();
    }
    expect(currentSource.metadata).toMatchObject({
      datasetId: first.datasetId,
      datasetRevisionId: first.revisionId,
      datasetTableCount: 1,
      datasetRowCount: 2,
      parserStatus: "dataset_materialized"
    });
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toHaveLength(1);
  });

  it("fails closed before bundle publication when the durable source binding changes during planning", async () => {
    const fixture = await makeCsvFixture();
    const planner: DatasetImportPlanner = {
      plan: async () => {
        const changed = SourceRecordSchema.parse({
          ...fixture.sourceRecord,
          managedCopy: { ...fixture.sourceRecord.managedCopy!, checksum: `sha256:${"b".repeat(64)}` },
          updatedAt: "2026-07-13T01:00:00.000Z"
        });
        fs.writeFileSync(fixture.sourceRecordPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");
        return csvPlan(fixture.sourceBytes);
      }
    };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.import.source_changed" });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toEqual([]);
  });

  it("rejects a malformed worker plan before publishing durable Dataset or Operation bytes", async () => {
    const fixture = await makeCsvFixture();
    const validPlan = csvPlan(fixture.sourceBytes);
    const malformedPlan = {
      ...validPlan,
      tables: validPlan.tables.map((table, tableIndex) => tableIndex === 0 ? {
        ...table,
        rows: table.rows.map((row, rowIndex) => rowIndex === 0 ? {
          ...row,
          cells: row.cells.map((entry, cellIndex) => cellIndex === 0 ? {
            ...entry,
            projection: { kind: "real" as const, value: Number.NaN }
          } : entry)
        } : row)
      } : table)
    } satisfies DatasetIngestPlan;
    const planner: DatasetImportPlanner = { plan: vi.fn(async () => malformedPlan) };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.import.invalid" });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toEqual([]);
  });

  it.each([
    ["unknown projection kind", { kind: "bogus", value: "x" }],
    ["invalid XLSX date system", { kind: "xlsx_date_serial", value: "45200", dateSystem: "1901" }]
  ])("rejects a worker plan with %s before durable publication", async (_label, invalidProjection) => {
    const fixture = await makeCsvFixture();
    const validPlan = csvPlan(fixture.sourceBytes);
    const malformedPlan = {
      ...validPlan,
      tables: validPlan.tables.map((table, tableIndex) => tableIndex === 0 ? {
        ...table,
        rows: table.rows.map((row, rowIndex) => rowIndex === 0 ? {
          ...row,
          cells: row.cells.map((entry, cellIndex) => cellIndex === 0 ? {
            ...entry,
            projection: invalidProjection as DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number]["projection"]
          } : entry)
        } : row)
      } : table)
    } satisfies DatasetIngestPlan;
    const planner: DatasetImportPlanner = { plan: vi.fn(async () => malformedPlan) };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.import.invalid" });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toEqual([]);
  });

  it("rejects a sparse worker plan before publishing a structurally lossy Dataset", async () => {
    const fixture = await makeCsvFixture();
    const validPlan = csvPlan(fixture.sourceBytes);
    const sparsePlan = {
      ...validPlan,
      stats: { ...validPlan.stats, cellCount: 3 },
      tables: validPlan.tables.map((table, tableIndex) => tableIndex === 0 ? {
        ...table,
        rows: table.rows.map((row, rowIndex) => rowIndex === 1
          ? { ...row, cells: row.cells.slice(0, 1) }
          : row)
      } : table)
    } satisfies DatasetIngestPlan;
    const planner: DatasetImportPlanner = { plan: vi.fn(async () => sparsePlan) };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.import.invalid" });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toEqual([]);
  });

  it("rejects Dataset publication through a symlinked vault directory", async () => {
    const fixture = await makeCsvFixture();
    const outside = path.join(path.dirname(fixture.vaultPath), "outside-datasets");
    fs.rmSync(path.join(fixture.vaultPath, "datasets"), { recursive: true, force: true });
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(fixture.vaultPath, "datasets"), "dir");
    const planner: DatasetImportPlanner = { plan: vi.fn(async () => csvPlan(fixture.sourceBytes)) };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.path_unsafe" });
    expect(planner.plan).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toEqual([]);
  });

  it("rejects a payload replacement that is not bound by the immutable revision", async () => {
    const fixture = await makeCsvFixture();
    const planner: DatasetImportPlanner = {
      plan: vi.fn(async () => csvPlan(fixture.sourceBytes))
    };
    const service = new DatasetService(planner);
    await service.materializeSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    );
    const currentSource = SourceRecordSchema.parse(readJson(fixture.sourceRecordPath));
    const bundlePath = onlyEntryPath(path.join(fixture.vaultPath, "datasets"));
    const manifestPath = path.join(bundlePath, "dataset.json");
    const manifest = DatasetManifestSchema.parse(readJson(manifestPath));
    const payloadPath = path.join(bundlePath, manifest.payload.path);
    const database = new DatabaseSync(payloadPath);
    try {
      database.prepare("UPDATE pige_dataset_meta SET value = ? WHERE key = ?").run("tampered-format", "format");
    } finally {
      database.close();
    }
    const payloadStat = fs.statSync(payloadPath);
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      ...manifest,
      payload: { ...manifest.payload, checksum: checksum(payloadPath), size: payloadStat.size }
    }, null, 2)}\n`, "utf8");

    await expect(service.materializeSource(
      fixture.vaultPath,
      currentSource,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.import.invalid" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(findJsonFiles(path.join(fixture.vaultPath, ".pige/operations"))).toHaveLength(1);
  });

  it("rejects a captured SQLite main file that was accompanied by live sidecars", async () => {
    const fixture = await makeCsvFixture();
    const source = SourceRecordSchema.parse({
      ...fixture.sourceRecord,
      kind: "sqlite_file",
      metadata: { ...fixture.sourceRecord.metadata, sqliteLiveSidecars: ["-wal"] }
    });
    fs.writeFileSync(fixture.sourceRecordPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
    const planner: DatasetImportPlanner = { plan: vi.fn(async () => csvPlan(fixture.sourceBytes)) };

    await expect(new DatasetService(planner).materializeSource(
      fixture.vaultPath,
      source,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toMatchObject({ code: "dataset.ingest.sqlite.live_sidecars_not_supported" });
    expect(planner.plan).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
  });
});

async function makeCsvFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-service-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Datasets",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-13T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Datasets");
  const vault = loadVaultSummary(vaultPath);
  const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
  const sourcePath = path.join(root, "records.csv");
  fs.writeFileSync(sourcePath, sourceBytes);
  const capture = await new LegacyCaptureFixture({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, vaultPath).submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(capture.sourceIds[0]);
  const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
  const sourceRecord = SourceRecordSchema.parse(readJson(sourceRecordPath));
  const job = JobRecordSchema.parse({
    id: "job_20260713_dataset001",
    class: "dataset_import",
    state: "running",
    sourceId,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    policyContextId: "policy_dataset_test",
    policyHash: `sha256:${"c".repeat(64)}`,
    message: "Dataset import running."
  });
  return { vaultPath, sourceBytes, sourceRecordPath, sourceRecord, job };
}

function csvPlan(sourceBytes: Buffer): DatasetIngestPlan {
  const cells = [
    [cell(0, "Ada", "text", { kind: "text", value: "Ada" }), cell(1, "3", "integer", { kind: "integer", value: "3" })],
    [cell(0, "Grace", "text", { kind: "text", value: "Grace" }), cell(1, "5", "integer", { kind: "integer", value: "5" })]
  ];
  return {
    schemaVersion: 1,
    planner: { id: "dataset_ingest", version: "1" },
    source: {
      kind: "csv_file",
      byteLength: sourceBytes.length,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      encoding: "utf-8",
      bom: false,
      delimiter: ",",
      quote: "\"",
      nullTokens: ["NULL", "\\N"],
      lineEndings: ["lf"]
    },
    target: { profile: "managed_collection", owner: "dataset_service", sourceDisposition: "preserve_as_evidence" },
    limits: {
      maxSourceBytes: 1024 * 1024,
      maxRows: 100,
      maxColumns: 10,
      maxCells: 1000,
      maxCellBytes: 1024,
      maxPlanValueBytes: 1024 * 1024,
      maxTables: 10,
      maxArchiveEntries: 100,
      maxArchiveUncompressedBytes: 1024 * 1024,
      maxXmlEntryBytes: 1024 * 1024,
      maxSelectedXmlBytes: 1024 * 1024
    },
    stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4, retainedValueBytes: 10 },
    tables: [{
      ordinal: 0,
      sourceName: "records",
      sourceLocator: "csv:records",
      sourceMetadata: { delimiter: "," },
      header: {
        mode: "auto",
        used: true,
        sourceRow: {
          ordinal: 0,
          sourceRow: 1,
          cells: [
            cell(0, "name", "text", { kind: "text", value: "name" }),
            cell(1, "count", "text", { kind: "text", value: "count" })
          ]
        }
      },
      columns: [
        { ordinal: 0, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["text"], stats: { missing: 0, empty: 0, null: 0, value: 2 } },
        { ordinal: 1, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["integer"], stats: { missing: 0, empty: 0, null: 0, value: 2 } }
      ],
      rows: cells.map((rowCells, index) => ({ ordinal: index, sourceRow: index + 2, cells: rowCells }))
    }],
    warnings: []
  };
}

function cell(
  columnOrdinal: number,
  text: string,
  sourceType: string,
  projection: DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number]["projection"]
) {
  return {
    columnOrdinal,
    state: "value" as const,
    sourceType,
    lexical: { raw: text, text, quoted: false },
    projection
  };
}

function checksum(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function onlyEntryPath(directory: string): string {
  const entries = fs.readdirSync(directory);
  expect(entries).toHaveLength(1);
  return path.join(directory, requireValue(entries[0]));
}

function findFile(root: string, suffix: string): string {
  const match = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`Missing file ending ${suffix}`);
  return path.join(match.parentPath, match.name);
}

function findJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}
