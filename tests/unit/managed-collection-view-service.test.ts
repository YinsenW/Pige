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
  OperationRecordSchema,
  SourceRecordSchema
} from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import { DatasetService } from "../../apps/desktop/src/main/services/dataset-service";
import { executeDatasetQuery } from "../../apps/desktop/src/main/services/dataset-query-core";
import {
  DATASET_QUERY_PROTOCOL_VERSION,
  type DatasetQueryExecutor
} from "../../apps/desktop/src/main/services/dataset-query-types";
import { ManagedCollectionViewService } from "../../apps/desktop/src/main/services/managed-collection-view-service";
import {
  createVaultOnDisk,
  loadVaultSummary
} from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
const directExecutor: DatasetQueryExecutor = {
  execute: async (input) => executeDatasetQuery({
    ...input,
    schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
    requestId: "collection-view-direct-test"
  })
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("ManagedCollectionViewService", () => {
  it("creates, applies, replays, revalidates, and forward-trashes one bounded saved view", async () => {
    const fixture = await makeFixture();
    const vault = loadVaultSummary(fixture.vaultPath);
    const port = { current: () => vault, activeVaultPath: () => fixture.vaultPath };
    const service = new ManagedCollectionViewService(port, directExecutor);
    const manifest = readManifest(fixture.bundlePath);
    const schema = DatasetSchemaRecordSchema.parse(readJson(path.join(fixture.bundlePath, manifest.schema.path)));
    const table = required(schema.tables[0]);
    const nameColumn = required(table.columns[0]);
    const countColumn = required(table.columns[1]);
    const manifestBytes = fs.readFileSync(path.join(fixture.bundlePath, "dataset.json"));
    const payloadBytes = fs.readFileSync(path.join(fixture.bundlePath, manifest.payload.path));
    const request = {
      apiVersion: 1 as const,
      requestId: "collection_request_viewcreateabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      expectedRevisionId: manifest.activeRevision,
      name: "Grace only",
      filter: { operator: "eq" as const, columnId: countColumn.id, value: 5 },
      sort: { columnId: nameColumn.id, direction: "desc" as const }
    };

    const committed = await service.createView(request);
    expect(committed).toMatchObject({
      status: "committed",
      viewId: expect.stringMatching(/^view_[a-z0-9]{12,}$/),
      operationId: expect.stringMatching(/^op_\d{8}_[a-z0-9]{8,}$/),
      snapshot: {
        revisionId: manifest.activeRevision,
        activeViewId: expect.stringMatching(/^view_/),
        totalRowCount: 2,
        returnedRowCount: 2,
        rows: [
          { cells: expect.arrayContaining([
            expect.objectContaining({ columnId: nameColumn.id, value: "Lin" }),
            expect.objectContaining({ columnId: countColumn.id, value: 5 })
          ]) },
          { cells: expect.arrayContaining([
            expect.objectContaining({ columnId: nameColumn.id, value: "Grace" }),
            expect.objectContaining({ columnId: countColumn.id, value: 5 })
          ]) }
        ],
        views: [{
          viewRevision: 1,
          name: "Grace only",
          filter: request.filter,
          sort: request.sort
        }]
      }
    });
    if (committed.status !== "committed") throw new Error("Saved view did not commit");
    expect(fs.readFileSync(path.join(fixture.bundlePath, "dataset.json"))).toEqual(manifestBytes);
    expect(fs.readFileSync(path.join(fixture.bundlePath, manifest.payload.path))).toEqual(payloadBytes);

    const pointerPath = path.join(fixture.bundlePath, "views", `${committed.viewId}.json`);
    const pointer = readJson(pointerPath) as { activeRevision?: unknown; revision?: { path?: unknown } };
    expect(pointer.activeRevision).toBe(1);
    expect(pointer.revision?.path).toBe(`views/${committed.viewId}/revisions/1.json`);
    const operation = OperationRecordSchema.parse(readJson(findFile(
      path.join(fixture.vaultPath, ".pige/operations"), `${committed.operationId}.json`
    )));
    expect(operation).toMatchObject({
      kind: "create_collection_view",
      reversible: "yes",
      targetRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "dataset", id: manifest.datasetId }),
        expect.objectContaining({ kind: "table", id: table.id }),
        expect.objectContaining({ kind: "view", id: committed.viewId })
      ])
    });
    expect(JSON.stringify([committed, operation])).not.toMatch(/sqlite|\/private|Ada,3|Grace,5/u);

    await expect(new ManagedCollectionViewService(port, directExecutor).createView(request)).resolves.toEqual(committed);
    await expect(service.open({
      apiVersion: 1,
      requestId: "collection_request_viewopenabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      viewId: committed.viewId
    })).resolves.toMatchObject({
      status: "ready",
      snapshot: { activeViewId: committed.viewId, totalRowCount: 2, returnedRowCount: 2 }
    });
    await expect(service.open({
      apiVersion: 1,
      requestId: "collection_request_viewbaseabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id
    })).resolves.toMatchObject({
      status: "ready",
      snapshot: { totalRowCount: 3, returnedRowCount: 3, views: [{ viewId: committed.viewId }] }
    });

    await expect(service.createView({
      ...request,
      requestId: "collection_request_viewduplicateabcdef"
    })).resolves.toMatchObject({ status: "duplicate", snapshot: { views: [{ viewId: committed.viewId }] } });
    await expect(service.createView({
      ...request,
      requestId: "collection_request_viewstaleabcdefgh",
      name: "Stale",
      expectedRevisionId: "dataset_rev_20260728_ffffffffffff"
    })).resolves.toMatchObject({ status: "stale", snapshot: { revisionId: manifest.activeRevision } });
    await expect(service.createView({
      ...request,
      requestId: "collection_request_viewinvalidabcdefgh",
      name: "Invalid",
      filter: { operator: "is_null", columnId: "column_ffffffffffff" }
    })).resolves.toMatchObject({ status: "ineligible" });

    const pointerBytes = fs.readFileSync(pointerPath);
    const driftExecutor: DatasetQueryExecutor = {
      execute: async (input) => {
        const result = await directExecutor.execute(input);
        const currentPointer = readJson(pointerPath) as Record<string, unknown>;
        fs.writeFileSync(pointerPath, `${JSON.stringify({
          ...currentPointer,
          updatedAt: "2026-07-28T00:01:00.000Z"
        }, null, 2)}\n`);
        return result;
      }
    };
    await expect(new ManagedCollectionViewService(port, driftExecutor).open({
      apiVersion: 1,
      requestId: "collection_request_viewdriftabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      viewId: committed.viewId
    })).resolves.toMatchObject({ status: "failed" });
    fs.writeFileSync(pointerPath, pointerBytes);

    const beforeUndoManifest = fs.readFileSync(path.join(fixture.bundlePath, "dataset.json"));
    const beforeUndoPayload = fs.readFileSync(path.join(fixture.bundlePath, manifest.payload.path));
    const undone = await service.undoCreateView({
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      viewId: committed.viewId,
      expectedViewRevision: 1
    });
    expect(undone).toMatchObject({
      revisionId: manifest.activeRevision,
      totalRowCount: 3,
      returnedRowCount: 3,
      views: []
    });
    expect(readJson(pointerPath)).toMatchObject({ activeRevision: 2 });
    expect(fs.existsSync(path.join(
      fixture.bundlePath, "views", committed.viewId, "revisions", "2.json"
    ))).toBe(true);
    expect(fs.readFileSync(path.join(fixture.bundlePath, "dataset.json"))).toEqual(beforeUndoManifest);
    expect(fs.readFileSync(path.join(fixture.bundlePath, manifest.payload.path))).toEqual(beforeUndoPayload);
    await expect(new ManagedCollectionViewService(port, directExecutor).open({
      apiVersion: 1,
      requestId: "collection_request_viewtrashedabcdefgh",
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      viewId: committed.viewId
    })).resolves.toMatchObject({ status: "not_found" });
    await expect(service.undoCreateView({
      activeVaultId: vault.vaultId,
      datasetId: manifest.datasetId,
      tableId: table.id,
      viewId: committed.viewId,
      expectedViewRevision: 1
    })).rejects.toMatchObject({ code: "collection.view_revision_changed" });
  }, 30_000);
});

async function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-collection-view-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Views",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-28T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Views");
  const vault = loadVaultSummary(vaultPath);
  const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\nLin,5\n", "utf8");
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
    id: "job_20260728_collectionview",
    class: "dataset_import",
    state: "running",
    sourceId,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    policyContextId: "policy_collection_view",
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
    bundlePath: required(fs.readdirSync(path.join(vaultPath, "datasets")).map(
      (entry) => path.join(vaultPath, "datasets", entry)
    )[0])
  };
}

function csvPlan(sourceBytes: Buffer): DatasetIngestPlan {
  const valueCell = (columnOrdinal: number, text: string, sourceType: string,
    projection: DatasetIngestPlan["tables"][number]["rows"][number]["cells"][number]["projection"]
  ) => ({
    columnOrdinal,
    state: "value" as const,
    sourceType,
    lexical: { raw: text, text, quoted: false },
    projection
  });
  const data = [["Ada", 3], ["Grace", 5], ["Lin", 5]] as const;
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
    stats: { tableCount: 1, rowCount: 3, columnCount: 2, cellCount: 6, retainedValueBytes: 18 },
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
        { ordinal: 0, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["text"], stats: { missing: 0, empty: 0, null: 0, value: 3 } },
        { ordinal: 1, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["integer"], stats: { missing: 0, empty: 0, null: 0, value: 3 } }
      ],
      rows: data.map(([name, count], index) => ({
        ordinal: index,
        sourceRow: index + 2,
        cells: [
          valueCell(0, name, "text", { kind: "text", value: name }),
          valueCell(1, String(count), "integer", { kind: "integer", value: String(count) })
        ]
      }))
    }],
    warnings: []
  };
}

function readManifest(bundlePath: string) {
  return DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findFile(root: string, name: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    } else if (entry.name === name) return candidate;
  }
  return "";
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value is missing.");
  return value;
}
