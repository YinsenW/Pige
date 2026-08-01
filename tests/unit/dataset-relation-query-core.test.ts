import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { executeDatasetQuery } from "../../apps/desktop/src/main/services/dataset-query-core";
import {
  DATASET_QUERY_DEFAULT_LIMITS,
  DATASET_QUERY_PROTOCOL_VERSION,
  type DatasetQueryWorkerRequest
} from "../../apps/desktop/src/main/services/dataset-query-types";

const roots: string[] = [];
const SOURCE_TABLE = "table_projects0001";
const TARGET_TABLE = "table_people000001";
const PROJECT = "column_project00001";
const OWNER = "column_owner0000001";
const PERSON = "column_person000000";
const RATE = "column_rate00000001";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Dataset relation query core", () => {
  it("joins one declared same-Dataset relation with target filtering and stable ordering", () => {
    const fixture = createFixture();
    const request = createRequest(fixture);
    const result = executeDatasetQuery(request);

    expect(result).toMatchObject({
      sourceMatchedRowCount: 1,
      matchedRowCount: 1,
      returnedRowCount: 1,
      truncated: false,
      returnedRowIds: ["row_project0000001"]
    });
    expect(result.columns.map(({ label }) => label)).toEqual(["project", "rate"]);
    expect(result.rows[0]?.values).toEqual(["Aurora", "80"]);
    expect(executeDatasetQuery({ ...request, requestId: "relation-repeat" }).resultHash).toBe(result.resultHash);
  });

  it("fails closed when a relation target does not belong to the bound target table", () => {
    const fixture = createFixture();
    const database = new DatabaseSync(fixture.payloadPath);
    try {
      database.prepare("UPDATE pige_dataset_cells SET projection_json = ? WHERE row_id = ? AND column_id = ?")
        .run(JSON.stringify({ kind: "pige_relation_target", schemaVersion: 1, targetRowId: "row_missing0000001" }),
          "row_project0000001", OWNER);
    } finally { database.close(); }
    const request = createRequest({ ...fixture, payloadChecksum: checksum(fixture.payloadPath) });
    expect(() => executeDatasetQuery(request)).toThrowError(expect.objectContaining({ code: "dataset.query.payload_invalid" }));
  });
});

interface Fixture { readonly payloadPath: string; readonly payloadChecksum: string }

function createFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-relation-query-"));
  roots.push(root);
  const payloadPath = path.join(root, "collection.sqlite");
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec(`
      CREATE TABLE pige_dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE pige_dataset_tables (
        table_id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL, source_name TEXT NOT NULL,
        source_locator TEXT NOT NULL, source_metadata_json TEXT NOT NULL, header_json TEXT NOT NULL,
        row_count INTEGER NOT NULL, column_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE pige_dataset_columns (
        column_id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL, name TEXT NOT NULL, projected_type TEXT NOT NULL,
        source_types_json TEXT NOT NULL, stats_json TEXT NOT NULL, UNIQUE(table_id, ordinal)
      ) STRICT;
      CREATE TABLE pige_dataset_rows (
        row_id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL, source_row INTEGER NOT NULL, UNIQUE(table_id, ordinal)
      ) STRICT;
      CREATE TABLE pige_dataset_cells (
        row_id TEXT NOT NULL REFERENCES pige_dataset_rows(row_id),
        column_id TEXT NOT NULL REFERENCES pige_dataset_columns(column_id), state TEXT NOT NULL,
        source_type TEXT NOT NULL, lexical_raw TEXT, lexical_text TEXT, quoted INTEGER,
        projection_kind TEXT NOT NULL, projection_json TEXT, formula_json TEXT, source_style_json TEXT,
        PRIMARY KEY(row_id, column_id)
      ) STRICT;
    `);
    const meta = database.prepare("INSERT INTO pige_dataset_meta VALUES (?, ?)");
    for (const [key, value] of [
      ["format", "pige-managed-collection-v1"], ["dataset_id", "dataset_20260801_joinfixture01"],
      ["revision_id", "dataset_rev_20260801_joinfixture01"], ["source_sha256", "a".repeat(64)],
      ["planner", "dataset_ingest@1"]
    ]) meta.run(key, value);
    const table = database.prepare("INSERT INTO pige_dataset_tables VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    table.run(SOURCE_TABLE, 0, "projects", "fixture:projects", "{}", "{}", 2, 2);
    table.run(TARGET_TABLE, 1, "people", "fixture:people", "{}", "{}", 2, 2);
    const column = database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)");
    column.run(PROJECT, SOURCE_TABLE, 0, "project", "text", "[\"text\"]", "{}");
    column.run(OWNER, SOURCE_TABLE, 1, "owner", "text", "[\"pige.relation.single\"]", "{}");
    column.run(PERSON, TARGET_TABLE, 0, "person", "text", "[\"text\"]", "{}");
    column.run(RATE, TARGET_TABLE, 1, "rate", "integer", "[\"integer\"]", "{}");
    const row = database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)");
    row.run("row_project0000001", SOURCE_TABLE, 0, 2);
    row.run("row_project0000002", SOURCE_TABLE, 1, 3);
    row.run("row_person00000001", TARGET_TABLE, 0, 2);
    row.run("row_person00000002", TARGET_TABLE, 1, 3);
    const cell = database.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)");
    scalar(cell, "row_project0000001", PROJECT, "text", "Aurora");
    relation(cell, "row_project0000001", OWNER, "row_person00000002");
    scalar(cell, "row_project0000002", PROJECT, "text", "Beacon");
    relation(cell, "row_project0000002", OWNER, "row_person00000001");
    scalar(cell, "row_person00000001", PERSON, "text", "Ada");
    scalar(cell, "row_person00000001", RATE, "integer", "40");
    scalar(cell, "row_person00000002", PERSON, "text", "Grace");
    scalar(cell, "row_person00000002", RATE, "integer", "80");
  } finally { database.close(); }
  return { payloadPath, payloadChecksum: checksum(payloadPath) };
}

function scalar(statement: ReturnType<DatabaseSync["prepare"]>, rowId: string, columnId: string,
  kind: "text" | "integer", value: string): void {
  statement.run(rowId, columnId, "value", kind, value, value, 0, kind, JSON.stringify({ kind, value }));
}
function relation(statement: ReturnType<DatabaseSync["prepare"]>, rowId: string, columnId: string, targetRowId: string): void {
  statement.run(rowId, columnId, "value", "pige.relation.single", null, null, null, "pige_relation_target_v1",
    JSON.stringify({ kind: "pige_relation_target", schemaVersion: 1, targetRowId }));
}
function checksum(filePath: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}
function createRequest(fixture: Fixture): DatasetQueryWorkerRequest {
  return {
    schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
    requestId: "relation-query",
    payloadPath: fixture.payloadPath,
    binding: {
      datasetId: "dataset_20260801_joinfixture01",
      revisionId: "dataset_rev_20260801_joinfixture01",
      schemaChecksum: `sha256:${"b".repeat(64)}`,
      payloadChecksum: fixture.payloadChecksum
    },
    table: { id: SOURCE_TABLE, name: "projects", rowCount: 2, columnCount: 2 },
    columns: [
      { id: PROJECT, tableId: SOURCE_TABLE, name: "project", ordinal: 0, logicalType: "string" },
      { id: RATE, tableId: TARGET_TABLE, name: "rate", ordinal: 1, logicalType: "integer" }
    ],
    join: { relationColumnId: OWNER, targetTable: { id: TARGET_TABLE, name: "people", rowCount: 2, columnCount: 2 } },
    plan: {
      selectColumnIds: [PROJECT, RATE],
      filters: [{ columnId: RATE, op: "gt", value: 50 }],
      groupByColumnIds: [], aggregates: [], orderBy: [{ by: RATE, direction: "desc" }], limit: 10
    },
    limits: { ...DATASET_QUERY_DEFAULT_LIMITS }
  };
}
