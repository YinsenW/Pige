import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatasetManifestSchema,
  DatasetSchemaRecordSchema,
  JobRecordSchema,
  SourceRecordSchema
} from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { DatasetService } from "../../apps/desktop/src/main/services/dataset-service";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import { ManagedCollectionService } from "../../apps/desktop/src/main/services/managed-collection-service";
import {
  createVaultOnDisk,
  loadVaultSummary
} from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ManagedCollectionService", () => {
  it("commits one immutable cell revision, adopts replay, and undoes through Activity", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = {
      current: () => vault,
      activeVaultPath: () => fixture.vaultPath
    };
    const service = new ManagedCollectionService(port);
    const initialManifest = readManifest(fixture.bundlePath);
    const initialSchema = DatasetSchemaRecordSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.schema.path))
    );
    const table = required(initialSchema.tables[0]);
    const nameColumn = required(table.columns[0]);
    const rowId = readFirstRowId(path.join(fixture.bundlePath, initialManifest.payload.path));
    const initialPayloadBytes = fs.readFileSync(path.join(fixture.bundlePath, initialManifest.payload.path));
    const initialSourceBytes = fs.readFileSync(fixture.sourceRecordPath);

    const opened = await service.open({
      apiVersion: 1,
      requestId: "collection_request_openabcdefghijkl",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("Collection did not open");
    expect(opened.snapshot.revisionId).toBe(initialManifest.activeRevision);
    expect(opened.snapshot.rows[0]).toMatchObject({ rowId });
    expect(opened.snapshot.rows[0]?.cells[0]).toEqual({
      columnId: nameColumn.id,
      value: "Ada",
      editable: true
    });

    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_editabcdefghijkl",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId,
      columnId: nameColumn.id,
      expectedRevisionId: initialManifest.activeRevision,
      value: "Ada Lovelace"
    };
    const committed = await service.editCell(request);
    expect(committed.status).toBe("committed");
    const replay = await service.editCell(request);
    expect(replay).toEqual(committed);

    const editedManifest = readManifest(fixture.bundlePath);
    expect(editedManifest.initialRevision).toBe(initialManifest.activeRevision);
    expect(editedManifest.activeRevision).not.toBe(initialManifest.activeRevision);
    expect(fs.readFileSync(path.join(fixture.bundlePath, initialManifest.payload.path)))
      .toEqual(initialPayloadBytes);
    expect(fs.readFileSync(fixture.sourceRecordPath)).toEqual(initialSourceBytes);

    await expect(service.editCell({
      ...request,
      requestId: "collection_request_staleabcdefghijk",
      value: "Stale write"
    })).resolves.toMatchObject({
      status: "stale",
      currentRevisionId: editedManifest.activeRevision
    });

    const activity = new KnowledgeActivityService(port, service);
    const listed = activity.list({ limit: 20 });
    const editActivity = listed.activities.find((entry) => entry.kind === "update_collection_cell");
    expect(editActivity).toMatchObject({
      status: "applied",
      canUndo: true,
      target: {
        kind: "collection",
        datasetId: initialManifest.datasetId,
        tableId: table.id,
        revisionId: editedManifest.activeRevision
      }
    });
    const undone = await activity.undo({
      operationId: required(editActivity).operationId,
      expectedRevisionId: editedManifest.activeRevision
    });
    expect(undone).toMatchObject({ status: "undone" });
    const afterUndoActivity = activity.list({ limit: 20 }).activities.find(
      (entry) => entry.operationId === required(editActivity).operationId
    );
    expect(afterUndoActivity).toMatchObject({
      status: "undone",
      canUndo: false,
      undoUnavailableReason: "already_undone",
      target: { kind: "collection", revisionId: undone.revisionId }
    });

    const afterUndo = await service.open({
      apiVersion: 1,
      requestId: "collection_request_afterundoabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id
    });
    expect(afterUndo.status).toBe("ready");
    if (afterUndo.status !== "ready") throw new Error("Collection did not reopen");
    expect(afterUndo.snapshot.rows[0]?.cells[0]?.value).toBe("Ada");
    expect(readManifest(fixture.bundlePath).activeRevision)
      .not.toBe(editedManifest.activeRevision);
  });

  it("adopts an exact request after immutable files publish before the manifest switch", async () => {
    const fixture = await makeCollectionFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionService(port);
    const initialManifestPath = path.join(fixture.bundlePath, "dataset.json");
    const initialManifestBytes = fs.readFileSync(initialManifestPath);
    const initialManifest = readManifest(fixture.bundlePath);
    const schema = DatasetSchemaRecordSchema.parse(
      readJson(path.join(fixture.bundlePath, initialManifest.schema.path))
    );
    const table = required(schema.tables[0]);
    const column = required(table.columns[0]);
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_crashadoptionabcd",
      activeVaultId: vault.vaultId,
      datasetId: initialManifest.datasetId,
      tableId: table.id,
      rowId: readFirstRowId(path.join(fixture.bundlePath, initialManifest.payload.path)),
      columnId: column.id,
      expectedRevisionId: initialManifest.activeRevision,
      value: "Adopted"
    };
    const first = await service.editCell(request);
    expect(first.status).toBe("committed");
    if (first.status !== "committed") throw new Error("Collection edit did not commit");
    fs.writeFileSync(initialManifestPath, initialManifestBytes);
    fs.rmSync(findFile(path.join(fixture.vaultPath, ".pige/operations"), `${first.operationId}.json`));

    const adopted = await new ManagedCollectionService(port).editCell(request);
    expect(adopted).toEqual(first);
    expect(readManifest(fixture.bundlePath).activeRevision).toBe(first.revisionId);
    expect(findFile(path.join(fixture.vaultPath, ".pige/operations"), `${first.operationId}.json`))
      .toContain(first.operationId);
  });
});

async function makeCollectionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-managed-collection-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Collections",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-27T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Collections");
  const vault = loadVaultSummary(vaultPath);
  const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
  const sourcePath = path.join(root, "records.csv");
  fs.writeFileSync(sourcePath, sourceBytes);
  const capture = await new LegacyCaptureFixture({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, vaultPath).submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_picker",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = required(capture.sourceIds[0]);
  const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
  const sourceRecord = SourceRecordSchema.parse(readJson(sourceRecordPath));
  const job = JobRecordSchema.parse({
    id: "job_20260727_collection01",
    class: "dataset_import",
    state: "running",
    sourceId,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    policyContextId: "policy_collection_test",
    policyHash: `sha256:${"c".repeat(64)}`,
    message: "Dataset import running."
  });
  await new DatasetService({ plan: async () => csvPlan(sourceBytes) }).materializeSource(
    vaultPath,
    sourceRecord,
    sourceRecordPath,
    job
  );
  return {
    vaultPath,
    sourceRecordPath,
    bundlePath: required(fs.readdirSync(path.join(vaultPath, "datasets")).map(
      (entry) => path.join(vaultPath, "datasets", entry)
    )[0])
  };
}

function csvPlan(sourceBytes: Buffer): DatasetIngestPlan {
  const valueCell = (
    columnOrdinal: number,
    text: string,
    sourceType: string,
    projection: DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number]["projection"]
  ) => ({
    columnOrdinal,
    state: "value" as const,
    sourceType,
    lexical: { raw: text, text, quoted: false },
    projection
  });
  const rows = [
    [valueCell(0, "Ada", "text", { kind: "text", value: "Ada" }), valueCell(1, "3", "integer", { kind: "integer", value: "3" })],
    [valueCell(0, "Grace", "text", { kind: "text", value: "Grace" }), valueCell(1, "5", "integer", { kind: "integer", value: "5" })]
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
            valueCell(0, "name", "text", { kind: "text", value: "name" }),
            valueCell(1, "count", "text", { kind: "text", value: "count" })
          ]
        }
      },
      columns: [
        { ordinal: 0, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["text"], stats: { missing: 0, empty: 0, null: 0, value: 2 } },
        { ordinal: 1, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["integer"], stats: { missing: 0, empty: 0, null: 0, value: 2 } }
      ],
      rows: rows.map((cells, index) => ({ ordinal: index, sourceRow: index + 2, cells }))
    }],
    warnings: []
  };
}

function readManifest(bundlePath: string) {
  return DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
}

function readFirstRowId(payloadPath: string): string {
  const database = new DatabaseSync(payloadPath, { readOnly: true });
  try {
    const row = database.prepare("SELECT row_id FROM pige_dataset_rows ORDER BY ordinal LIMIT 1").get() as {
      row_id?: unknown;
    } | undefined;
    if (typeof row?.row_id !== "string") throw new Error("Missing Dataset row");
    return row.row_id;
  } finally {
    database.close();
  }
}

function findFile(root: string, suffix: string): string {
  const match = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(suffix));
  if (!match) throw new Error(`Missing file ending ${suffix}`);
  return path.join(match.parentPath, match.name);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}
