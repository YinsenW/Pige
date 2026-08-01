import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DatasetManifestSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  CollectionSnapshotSchema,
  JobRecordSchema,
  OperationRecordSchema,
  SourceRecordSchema,
  type CollectionAddFormulaColumnRequest,
  type DatasetPigeFormulaExpression
} from "@pige/schemas";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { DatasetService } from "../../apps/desktop/src/main/services/dataset-service";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import {
  adoptFormulaColumnMutation,
  appendFormulaCellsForNewRow,
  canonicalFormulaExpressionIdentity,
  commitFormulaColumnAdd,
  createFormulaColumnId,
  createFormulaMutationIdentity,
  evaluateFormulaExpression,
  formulaReferencedColumnIds,
  projectCollectionFormulaColumns,
  recomputeFormulaCellsForEditedRow
} from "../../apps/desktop/src/main/services/managed-collection-formula-storage";
import {
  fileRef,
  readBundle,
  readRevisionById,
  type BundleBinding
} from "../../apps/desktop/src/main/services/managed-collection-storage";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("managed collection formula storage", () => {
  it("evaluates the bounded typed AST deterministically and derives canonical identities", () => {
    const expression: DatasetPigeFormulaExpression = {
      kind: "binary",
      operator: "divide",
      left: {
        kind: "binary",
        operator: "add",
        left: { kind: "column", columnId: "column_count1234567" },
        right: { kind: "column", columnId: "column_bonus1234567" }
      },
      right: { kind: "literal", value: 2 }
    };
    expect(evaluateFormulaExpression(expression, (columnId) => columnId.includes("count") ? 6 : 2)).toBe(4);
    expect(evaluateFormulaExpression(expression, () => null)).toBeNull();
    expect(evaluateFormulaExpression(expression, () => "")).toBeNull();
    expect(evaluateFormulaExpression({
      kind: "binary", operator: "divide",
      left: { kind: "literal", value: 1 }, right: { kind: "literal", value: 0 }
    }, () => 1)).toBeNull();
    expect(evaluateFormulaExpression({
      kind: "binary", operator: "multiply",
      left: { kind: "literal", value: Number.MAX_VALUE },
      right: { kind: "literal", value: Number.MAX_VALUE }
    }, () => 1)).toBeNull();
    expect(Object.is(evaluateFormulaExpression({
      kind: "binary", operator: "multiply",
      left: { kind: "literal", value: -1 }, right: { kind: "literal", value: 0 }
    }, () => 1), -0)).toBe(false);
    expect(formulaReferencedColumnIds(expression)).toEqual(["column_bonus1234567", "column_count1234567"]);
    expect(canonicalFormulaExpressionIdentity(expression)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(createFormulaColumnId("table_records123456", "collection_request_formulaidentity1"))
      .toMatch(/^column_[a-f0-9]{20}$/u);
  });

  it("projects edit authority only for builder-lossless formula expressions", () => {
    const operand = {
      id: "column_operand1234567", name: "Count", ordinal: 0, sourceType: "integer", sourceTypes: ["integer"],
      logicalType: "integer" as const, nullable: true, stats: { missing: 0, empty: 0, null: 0, value: 1 }
    };
    const simple = {
      id: "column_simple12345678", name: "Simple", ordinal: 1, sourceType: "pige_numeric_formula_v1",
      sourceTypes: ["pige_numeric_formula_v1"], logicalType: "number" as const, nullable: true,
      calculation: { kind: "pige_numeric_formula" as const, schemaVersion: 1 as const,
        expression: { kind: "binary" as const, operator: "multiply" as const,
          left: { kind: "column" as const, columnId: operand.id }, right: { kind: "literal" as const, value: 2 } } },
      stats: { missing: 0, empty: 0, null: 0, value: 1 }
    };
    const nested = {
      ...simple, id: "column_nested12345678", name: "Nested", ordinal: 2,
      calculation: { ...simple.calculation, expression: { kind: "binary" as const, operator: "add" as const,
        left: { kind: "binary" as const, operator: "multiply" as const,
          left: { kind: "column" as const, columnId: operand.id }, right: { kind: "literal" as const, value: 2 } },
        right: { kind: "literal" as const, value: 1 } } }
    };
    expect(projectCollectionFormulaColumns([operand, simple, nested])).toEqual(expect.arrayContaining([
      expect.objectContaining({ columnId: simple.id, canEditFormula: true }),
      expect.objectContaining({ columnId: nested.id, canEditFormula: false })
    ]));
  });

  it("adds and adopts one immutable formula revision with computed payload and schema truth", async () => {
    const fixture = await makeCollectionFixture();
    const binding = required(readBundle(fixture.vaultPath, fixture.datasetId));
    const table = required(binding.schema.tables[0]);
    const countColumn = required(table.columns.find((column) => column.logicalType === "integer"));
    const request: CollectionAddFormulaColumnRequest = {
      apiVersion: 1,
      requestId: "collection_request_formulaaddtruth1",
      activeVaultId: loadVaultSummary(fixture.vaultPath).vaultId,
      datasetId: binding.manifest.datasetId,
      tableId: table.id,
      expectedRevisionId: binding.revision.id,
      label: "Count plus two",
      expression: {
        kind: "binary",
        operator: "add",
        left: { kind: "column", columnId: countColumn.id },
        right: { kind: "literal", value: 2 }
      }
    };
    const identity = createFormulaMutationIdentity(request);
    const manifestBytes = fs.readFileSync(binding.manifestPath);
    const priorPayloadBytes = fs.readFileSync(binding.payloadPath);
    const committed = commitFormulaColumnAdd({ binding, request, identity });

    expect(committed.revision).toMatchObject({
      id: identity.revisionId,
      parentRevisionId: request.expectedRevisionId,
      operationId: identity.operationId,
      change: { kind: "collection_column_add", tableId: table.id, columnId: identity.columnId },
      payload: { path: `data/revisions/${identity.revisionId}.sqlite`, format: "sqlite" }
    });
    expect(fs.readFileSync(binding.payloadPath)).toEqual(priorPayloadBytes);
    const schema = DatasetSchemaRecordSchema.parse(readJson(path.join(committed.binding.bundlePath, committed.revision.schema.path)));
    const formulaColumn = required(schema.tables[0]?.columns.find((column) => column.id === identity.columnId));
    expect(formulaColumn).toMatchObject({
      name: "Count plus two",
      logicalType: "number",
      nullable: true,
      calculation: { kind: "pige_numeric_formula", schemaVersion: 1, expression: request.expression },
      stats: { missing: 0, empty: 0, null: 1, value: 1 }
    });
    expect(projectCollectionFormulaColumns(required(schema.tables[0]).columns)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        columnId: countColumn.id,
        canTrash: false,
        canUseAsFormulaOperand: true
      }),
      expect.objectContaining({
        columnId: identity.columnId,
        canRename: true,
        canTrash: true,
        canUseAsFormulaOperand: true,
        calculation: expect.objectContaining({ kind: "pige_numeric_formula" })
      })
    ]));
    const database = new DatabaseSync(committed.binding.payloadPath, { readOnly: true });
    try {
      const cells = database.prepare([
        "SELECT state, projection_json, formula_json FROM pige_dataset_cells",
        "WHERE column_id = ? ORDER BY row_id"
      ].join(" ")).all(identity.columnId) as Array<Record<string, unknown>>;
      expect(cells).toHaveLength(2);
      expect(cells.map((cell) => cell.state).sort()).toEqual(["null", "value"]);
      expect(cells.some((cell) => cell.projection_json === JSON.stringify({ kind: "real", value: 5 }))).toBe(true);
      expect(cells.every((cell) => typeof cell.formula_json === "string")).toBe(true);
    } finally {
      database.close();
    }

    fs.writeFileSync(binding.manifestPath, manifestBytes);
    const replayBinding = required(readBundle(fixture.vaultPath, fixture.datasetId));
    const adopted = adoptFormulaColumnMutation({
      binding: replayBinding,
      request,
      identity,
      readSnapshot: formulaSnapshot,
      createOperation: createOperation
    });
    expect(adopted).toMatchObject({
      status: "committed",
      columnId: identity.columnId,
      operationId: identity.operationId,
      snapshot: { revisionId: identity.revisionId }
    });
    expect(readBundle(fixture.vaultPath, fixture.datasetId)?.manifest.activeRevision).toBe(identity.revisionId);
    expect(adoptFormulaColumnMutation({
      binding: required(readBundle(fixture.vaultPath, fixture.datasetId)),
      request,
      identity,
      readSnapshot: formulaSnapshot,
      createOperation
    })).toEqual(adopted);
  });

  it("recomputes edited rows and appends formula cells inside caller-owned transactions", async () => {
    const fixture = await makeCollectionFixture();
    const binding = required(readBundle(fixture.vaultPath, fixture.datasetId));
    const table = required(binding.schema.tables[0]);
    const countColumn = required(table.columns.find((column) => column.logicalType === "integer"));
    const request: CollectionAddFormulaColumnRequest = {
      apiVersion: 1,
      requestId: "collection_request_formulahelpers12",
      activeVaultId: loadVaultSummary(fixture.vaultPath).vaultId,
      datasetId: binding.manifest.datasetId,
      tableId: table.id,
      expectedRevisionId: binding.revision.id,
      label: "Double count",
      expression: {
        kind: "binary", operator: "multiply",
        left: { kind: "column", columnId: countColumn.id }, right: { kind: "literal", value: 2 }
      }
    };
    const committed = commitFormulaColumnAdd({
      binding,
      request,
      identity: createFormulaMutationIdentity(request)
    });
    const formulaTable = required(committed.binding.schema.tables[0]);
    const formulaColumn = required(formulaTable.columns.find((column) => column.calculation?.kind === "pige_numeric_formula"));
    const database = new DatabaseSync(committed.binding.payloadPath);
    try {
      database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      const row = database.prepare("SELECT row_id FROM pige_dataset_rows WHERE table_id = ? ORDER BY ordinal LIMIT 1")
        .get(table.id) as { row_id: string };
      database.prepare(
        "UPDATE pige_dataset_cells SET state = 'value', projection_kind = 'integer', projection_json = ? WHERE row_id = ? AND column_id = ?"
      ).run(JSON.stringify({ kind: "integer", value: 7 }), row.row_id, countColumn.id);
      recomputeFormulaCellsForEditedRow(database, formulaTable, row.row_id);
      expect(readFormulaValue(database, row.row_id, formulaColumn.id)).toBe(14);

      const newRowId = "row_formulaappend123456";
      database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)").run(newRowId, table.id, 2, 4);
      for (const column of formulaTable.columns.filter((candidate) => candidate.calculation === undefined)) {
        database.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, 'null', 'pige_user_nullable', NULL, NULL, NULL, 'null', NULL, NULL, NULL)")
          .run(newRowId, column.id);
      }
      database.prepare(
        "UPDATE pige_dataset_cells SET state = 'value', projection_kind = 'integer', projection_json = ? WHERE row_id = ? AND column_id = ?"
      ).run(JSON.stringify({ kind: "integer", value: 4 }), newRowId, countColumn.id);
      appendFormulaCellsForNewRow(database, formulaTable, newRowId);
      expect(readFormulaValue(database, newRowId, formulaColumn.id)).toBe(8);
      database.exec("ROLLBACK");
    } finally {
      database.close();
    }
  });
});

function createOperation(binding: BundleBinding, revision: ReturnType<typeof readRevisionById>) {
  const before = readRevisionById(binding, required(revision.parentRevisionId ?? undefined));
  const change = revision.change;
  if (change?.kind !== "collection_column_add") throw new Error("Expected formula column add");
  const beforeRef = {
    kind: "dataset_revision" as const,
    id: before.id,
    path: `${binding.bundleRelativePath}/revisions/${before.id}.json`,
    checksum: fileRef(binding.bundlePath, `revisions/${before.id}.json`).checksum
  };
  const afterRef = {
    kind: "dataset_revision" as const,
    id: revision.id,
    path: `${binding.bundleRelativePath}/revisions/${revision.id}.json`,
    checksum: fileRef(binding.bundlePath, `revisions/${revision.id}.json`).checksum
  };
  return OperationRecordSchema.parse({
    id: revision.operationId,
    schemaVersion: 1,
    createdAt: revision.createdAt,
    actor: { kind: "user", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "add_collection_column",
    targetRefs: [
      { kind: "dataset", id: revision.datasetId, path: binding.bundleRelativePath },
      afterRef,
      { kind: "table", id: change.tableId },
      { kind: "column", id: change.columnId }
    ],
    sourceRefs: [beforeRef],
    before: beforeRef,
    after: afterRef,
    summary: `Added one formula Collection column through immutable revision ${revision.id}.`,
    reversible: "yes",
    rollbackHint: "Create another revision only while this Operation's after-revision remains current.",
    warnings: []
  });
}

function formulaSnapshot(binding: BundleBinding, tableId: string) {
  const table = binding.schema.tables.find((candidate) => candidate.id === tableId);
  if (!table) return undefined;
  return CollectionSnapshotSchema.parse({
    datasetId: binding.manifest.datasetId,
    revisionId: binding.revision.id,
    title: binding.manifest.title,
    tableId,
    tableName: table.name,
    columns: projectCollectionFormulaColumns(table.columns),
    rows: [],
    totalRowCount: table.rowCount,
    returnedRowCount: 0,
    truncated: table.rowCount > 0,
    canAppendDefaultRow: true,
    canAddColumn: table.columns.length < 32,
    canAddFormulaColumn: table.columns.length < 32 && table.columns.some((column) =>
      column.calculation === undefined && (column.logicalType === "integer" || column.logicalType === "number")),
    views: []
  });
}

async function makeCollectionFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-formula-storage-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Collections",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-29T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Collections");
  const vault = loadVaultSummary(vaultPath);
  const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
  const sourcePath = path.join(root, "records.csv");
  fs.writeFileSync(sourcePath, sourceBytes);
  const capture = await new LegacyCaptureFixture({ current: () => vault, activeVaultPath: () => vaultPath }, vaultPath)
    .submitFiles({ filePaths: [sourcePath], inputKind: "file_picker", userIntent: "capture", locale: "en" });
  const sourceId = required(capture.sourceIds[0]);
  const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
  const sourceRecord = SourceRecordSchema.parse(readJson(sourceRecordPath));
  const job = JobRecordSchema.parse({
    id: "job_20260729_formula0001",
    class: "dataset_import",
    state: "running",
    sourceId,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    policyContextId: "policy_formula_test",
    policyHash: `sha256:${"c".repeat(64)}`,
    message: "Dataset import running."
  });
  await new DatasetService({ plan: async () => csvPlan(sourceBytes) })
    .materializeSource(vaultPath, sourceRecord, sourceRecordPath, job);
  const bundlePath = required(fs.readdirSync(path.join(vaultPath, "datasets"))
    .map((entry) => path.join(vaultPath, "datasets", entry))[0]);
  const manifest = DatasetManifestSchema.parse(readJson(path.join(bundlePath, "dataset.json")));
  return { vaultPath, bundlePath, datasetId: manifest.datasetId };
}

function csvPlan(sourceBytes: Buffer): DatasetIngestPlan {
  const value = (columnOrdinal: number, raw: string, kind: "text" | "integer") => ({
    columnOrdinal,
    state: "value" as const,
    sourceType: kind,
    lexical: { raw, text: raw, quoted: false },
    projection: { kind, value: raw }
  });
  const nullCell = (columnOrdinal: number) => ({
    columnOrdinal,
    state: "null" as const,
    sourceType: "integer",
    lexical: { raw: "NULL", text: "NULL", quoted: false },
    projection: { kind: "null" as const }
  });
  return {
    schemaVersion: 1,
    planner: { id: "dataset_ingest", version: "1" },
    source: {
      kind: "csv_file", byteLength: sourceBytes.length,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      encoding: "utf-8", bom: false, delimiter: ",", quote: "\"", nullTokens: ["NULL"], lineEndings: ["lf"]
    },
    target: { profile: "managed_collection", owner: "dataset_service", sourceDisposition: "preserve_as_evidence" },
    limits: {
      maxSourceBytes: 1024 * 1024, maxRows: 100, maxColumns: 10, maxCells: 1000,
      maxCellBytes: 1024, maxPlanValueBytes: 1024 * 1024, maxTables: 10,
      maxArchiveEntries: 100, maxArchiveUncompressedBytes: 1024 * 1024,
      maxXmlEntryBytes: 1024 * 1024, maxSelectedXmlBytes: 1024 * 1024
    },
    stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4, retainedValueBytes: 10 },
    tables: [{
      ordinal: 0, sourceName: "records", sourceLocator: "csv:records", sourceMetadata: { delimiter: "," },
      header: {
        mode: "auto",
        used: true,
        sourceRow: {
          ordinal: 0,
          sourceRow: 1,
          cells: [value(0, "name", "text"), value(1, "count", "text")]
        }
      },
      columns: [
        { ordinal: 0, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["text"], stats: { missing: 0, empty: 0, null: 0, value: 2 } },
        { ordinal: 1, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["integer"], stats: { missing: 0, empty: 0, null: 1, value: 1 } }
      ],
      rows: [
        { ordinal: 0, sourceRow: 2, cells: [value(0, "Ada", "text"), value(1, "3", "integer")] },
        { ordinal: 1, sourceRow: 3, cells: [value(0, "Grace", "text"), nullCell(1)] }
      ]
    }],
    warnings: []
  };
}

function readFormulaValue(database: DatabaseSync, rowId: string, columnId: string): number | null {
  const row = database.prepare("SELECT state, projection_json FROM pige_dataset_cells WHERE row_id = ? AND column_id = ?")
    .get(rowId, columnId) as { state?: unknown; projection_json?: unknown } | undefined;
  if (row?.state === "null") return null;
  if (row?.state !== "value" || typeof row.projection_json !== "string") throw new Error("Missing formula value");
  return (JSON.parse(row.projection_json) as { value: number }).value;
}

function findFile(root: string, suffix: string): string {
  const entry = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .find((candidate) => candidate.isFile() && candidate.name.endsWith(suffix));
  if (!entry) throw new Error(`Missing ${suffix}`);
  return path.join(entry.parentPath, entry.name);
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value");
  return value;
}
