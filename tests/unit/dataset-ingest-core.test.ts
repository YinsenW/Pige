import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import { planDatasetIngest } from "../../apps/desktop/src/main/services/dataset-ingest-core";
import {
  DATASET_INGEST_DEFAULT_LIMITS,
  type DatasetIngestLimits
} from "../../apps/desktop/src/main/services/dataset-ingest-types";
import {
  DATASET_INGEST_WORKER_ENTRY_NAME,
  DATASET_INGEST_WORKER_ENTRY_RELATIVE_PATH
} from "../../apps/desktop/src/shared/dataset-ingest-worker";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Dataset ingest core", () => {
  it("preserves CSV lexical tokens and missing, empty, null, and value states deterministically", async () => {
    const filePath = writeFixture(
      "states.csv",
      'name,code,nullable,empty,tail\r\nAlice,"a,b",NULL,"",last\r\nBob,42,"NULL",,\r\nOnly,7'
    );
    const request = {
      requestId: "csv-states",
      filePath,
      sourceKind: "csv_file" as const,
      limits: ingestLimits(),
      csv: { delimiter: "auto", header: "present" as const }
    };

    const first = await planDatasetIngest(request);
    const second = await planDatasetIngest(request);

    expect(second).toEqual(first);
    expect(first.source).toMatchObject({
      kind: "csv_file",
      encoding: "utf-8",
      delimiter: ",",
      lineEndings: ["crlf", "none"]
    });
    expect(first.tables[0]?.columns.map((column) => column.sourceName)).toEqual([
      "name",
      "code",
      "nullable",
      "empty",
      "tail"
    ]);
    const [alice, bob, only] = first.tables[0]!.rows;
    expect(alice?.cells[1]).toMatchObject({
      state: "value",
      lexical: { raw: '"a,b"', text: "a,b", quoted: true },
      projection: { kind: "text", value: "a,b" }
    });
    expect(alice?.cells[2]).toMatchObject({ state: "null", lexical: { raw: "NULL" }, projection: { kind: "null" } });
    expect(alice?.cells[3]).toMatchObject({ state: "empty", lexical: { raw: '""', quoted: true } });
    expect(bob?.cells[1]?.projection).toEqual({ kind: "integer", value: "42" });
    expect(bob?.cells[2]).toMatchObject({ state: "value", lexical: { raw: '"NULL"', quoted: true } });
    expect(bob?.cells[3]).toMatchObject({ state: "empty", lexical: { raw: "", quoted: false } });
    expect(bob?.cells[4]).toMatchObject({ state: "empty", lexical: { raw: "", quoted: false } });
    expect(only?.cells.slice(2).map((cell) => cell.state)).toEqual(["missing", "missing", "missing"]);
  });

  it("uses a state machine for quoted newlines and rejects malformed quotes and rectangular limit overflow", async () => {
    const validPath = writeFixture("multiline.csv", 'id,note\n1,"line one\nline two"');
    const valid = await planDatasetIngest({
      requestId: "csv-multiline",
      filePath: validPath,
      sourceKind: "csv_file",
      limits: ingestLimits(),
      csv: { header: "present" }
    });
    expect(valid.tables[0]?.rows[0]?.cells[1]?.lexical).toEqual({
      raw: '"line one\nline two"',
      text: "line one\nline two",
      quoted: true
    });

    const malformedPath = writeFixture("malformed.csv", 'id,value\n1,"closed"tail');
    await expect(planDatasetIngest({
      requestId: "csv-malformed",
      filePath: malformedPath,
      sourceKind: "csv_file",
      limits: ingestLimits()
    })).rejects.toMatchObject({ code: "dataset.ingest.csv.invalid_quote" });

    const sparsePath = writeFixture("sparse.csv", "a,b,c\n1");
    await expect(planDatasetIngest({
      requestId: "csv-cell-bound",
      filePath: sparsePath,
      sourceKind: "csv_file",
      limits: ingestLimits({ maxCells: 4 }),
      csv: { header: "absent" }
    })).rejects.toMatchObject({ code: "dataset.ingest.limit.cell" });
  });

  it("preserves XLSX sheet order, source types, formula text, and cached values without calculation", async () => {
    const filePath = writeFixture("formula.xlsx", await createXlsxFixture());
    const plan = await planDatasetIngest({
      requestId: "xlsx-formulas",
      filePath,
      sourceKind: "xlsx_file",
      limits: ingestLimits(),
      xlsx: { header: "present" }
    });

    expect(plan.source).toMatchObject({
      kind: "xlsx_file",
      dateSystem: "1900",
      calculationMode: "manual",
      sheetCount: 2,
      formulaCount: 2
    });
    expect(plan.tables.map((table) => table.sourceName)).toEqual(["Second", "First"]);
    const cachedFormula = plan.tables[0]?.rows[0]?.cells[1];
    expect(cachedFormula).toMatchObject({
      state: "value",
      sourceType: "xlsx.formula.xlsx.date_serial",
      lexical: { raw: "45200", text: "45200" },
      projection: { kind: "xlsx_date_serial", value: "45200", dateSystem: "1900" },
      formula: { text: "SUM(1,1)", kind: "normal", hasCachedValue: true },
      sourceStyle: { index: 1, numberFormatId: 14 }
    });
    expect(plan.tables[0]?.rows[0]?.cells[2]).toMatchObject({
      state: "missing",
      projection: { kind: "unknown" },
      formula: { text: "", kind: "shared", sharedIndex: "0", hasCachedValue: false }
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "dataset.ingest.xlsx.formulas_not_evaluated",
      "dataset.ingest.xlsx.formula_cache_missing",
      "dataset.ingest.xlsx.manual_calculation"
    ]));
  });

  it.each([
    ["macro", { name: "xl/vbaProject.bin", data: Buffer.from("not-executed") }, "dataset.ingest.xlsx.macros_not_allowed"],
    ["ActiveX", { name: "xl/activeX/activeX1.bin", data: Buffer.from("not-executed") }, "dataset.ingest.xlsx.activex_not_allowed"],
    ["OLE", { name: "xl/embeddings/oleObject1.bin", data: Buffer.from("not-opened") }, "dataset.ingest.xlsx.ole_not_allowed"]
  ])("rejects %s workbook package parts", async (_label, extraEntry, code) => {
    const filePath = writeFixture("hostile.xlsx", await createXlsxFixture([extraEntry]));
    await expect(planDatasetIngest({
      requestId: `xlsx-${_label}`,
      filePath,
      sourceKind: "xlsx_file",
      limits: ingestLimits()
    })).rejects.toMatchObject({ code });
  });

  it("rejects external workbook relationships and legacy or encrypted OLE containers", async () => {
    const externalRelationship = {
      name: "xl/worksheets/_rels/sheet1.xml.rels",
      data: relationships([
        '<Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/data" TargetMode="External"/>'
      ])
    };
    const externalPath = writeFixture("external.xlsx", await createXlsxFixture([externalRelationship]));
    await expect(planDatasetIngest({
      requestId: "xlsx-external",
      filePath: externalPath,
      sourceKind: "xlsx_file",
      limits: ingestLimits()
    })).rejects.toMatchObject({ code: "dataset.ingest.xlsx.external_resources_not_allowed" });

    const olePath = writeFixture("legacy.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]));
    await expect(planDatasetIngest({
      requestId: "xlsx-ole",
      filePath: olePath,
      sourceKind: "xlsx_file",
      limits: ingestLimits()
    })).rejects.toMatchObject({ code: "dataset.ingest.xlsx.legacy_encrypted_or_ole" });
  });

  it("reads ordinary SQLite tables with exact storage types and leaves source bytes unchanged", async () => {
    const filePath = createSqliteFixture((database) => {
      database.exec(`
        CREATE TABLE z_table (ignored TEXT);
        CREATE TABLE records (
          id INTEGER PRIMARY KEY,
          big_value INTEGER,
          score REAL,
          label TEXT,
          empty_text TEXT,
          payload BLOB,
          nullable TEXT
        );
      `);
      database.prepare(
        "INSERT INTO records(id, big_value, score, label, empty_text, payload, nullable) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(1, 9_007_199_254_740_993n, 1.5, "local", "", Uint8Array.from([0, 1, 255]), null);
    });
    const before = sha256File(filePath);

    const plan = await planDatasetIngest({
      requestId: "sqlite-types",
      filePath,
      sourceKind: "sqlite_file",
      limits: ingestLimits()
    });

    expect(sha256File(filePath)).toBe(before);
    expect(plan.source).toMatchObject({
      kind: "sqlite_file",
      openedReadOnly: true,
      defensive: true,
      extensionsEnabled: false,
      authorizerPolicy: "schema_and_table_reads_only"
    });
    expect(plan.tables.map((table) => table.sourceName)).toEqual(["records", "z_table"]);
    const row = plan.tables[0]!.rows[0]!;
    expect(row.cells[0]).toMatchObject({ sourceType: "sqlite.integer", projection: { kind: "integer", value: "1" } });
    expect(row.cells[1]).toMatchObject({ projection: { kind: "integer", value: "9007199254740993" } });
    expect(row.cells[2]).toMatchObject({ sourceType: "sqlite.real", projection: { kind: "real", value: 1.5 } });
    expect(row.cells[3]).toMatchObject({ sourceType: "sqlite.text", projection: { kind: "text", value: "local" } });
    expect(row.cells[4]).toMatchObject({ state: "empty", projection: { kind: "text", value: "" } });
    expect(row.cells[5]).toMatchObject({
      sourceType: "sqlite.blob",
      projection: { kind: "blob", value: "AAH/", encoding: "base64", byteLength: 3 }
    });
    expect(row.cells[6]).toMatchObject({ state: "null", sourceType: "sqlite.null", projection: { kind: "null" } });
    expect(plan.tables[0]?.columns[1]?.sourceMetadata).toMatchObject({ declaredType: "INTEGER" });
  });

  it.each([
    ["view", "CREATE TABLE base(a); CREATE VIEW unsafe_view AS SELECT a FROM base;", "dataset.ingest.sqlite.views_not_allowed"],
    ["trigger", "CREATE TABLE base(a); CREATE TRIGGER unsafe_trigger AFTER INSERT ON base BEGIN SELECT 1; END;", "dataset.ingest.sqlite.triggers_not_allowed"],
    ["virtual table", "CREATE VIRTUAL TABLE unsafe_virtual USING fts5(content);", "dataset.ingest.sqlite.virtual_tables_not_allowed"],
    ["generated column", "CREATE TABLE generated(a INTEGER, b INTEGER GENERATED ALWAYS AS (a + 1) STORED);", "dataset.ingest.sqlite.generated_columns_not_allowed"]
  ])("rejects SQLite sources containing a %s", async (_label, sql, code) => {
    const filePath = createSqliteFixture((database) => database.exec(sql));
    await expect(planDatasetIngest({
      requestId: `sqlite-${_label}`,
      filePath,
      sourceKind: "sqlite_file",
      limits: ingestLimits()
    })).rejects.toMatchObject({ code });
  });

  it("enforces SQLite row bounds before returning a partial plan", async () => {
    const filePath = createSqliteFixture((database) => {
      database.exec("CREATE TABLE bounded(value INTEGER); INSERT INTO bounded VALUES (1), (2), (3);");
    });
    await expect(planDatasetIngest({
      requestId: "sqlite-row-bound",
      filePath,
      sourceKind: "sqlite_file",
      limits: ingestLimits({ maxRows: 2 })
    })).rejects.toMatchObject({ code: "dataset.ingest.limit.row" });
  });

  it("publishes the worker entry names used by the main-process adapter", () => {
    expect(DATASET_INGEST_WORKER_ENTRY_NAME).toBe("workers/dataset-ingest-worker");
    expect(DATASET_INGEST_WORKER_ENTRY_RELATIVE_PATH).toBe(`./${DATASET_INGEST_WORKER_ENTRY_NAME}.js`);
  });
});

function ingestLimits(overrides: Partial<DatasetIngestLimits> = {}): DatasetIngestLimits {
  return { ...DATASET_INGEST_DEFAULT_LIMITS, ...overrides };
}

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-ingest-test-"));
  tempRoots.push(root);
  return root;
}

function writeFixture(name: string, value: string | Buffer): string {
  const filePath = path.join(createTempRoot(), name);
  fs.writeFileSync(filePath, value);
  return filePath;
}

function createSqliteFixture(populate: (database: DatabaseSync) => void): string {
  const filePath = path.join(createTempRoot(), "source.sqlite");
  const database = new DatabaseSync(filePath, { allowExtension: false, defensive: true });
  try {
    populate(database);
  } finally {
    database.close();
  }
  return filePath;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

interface ZipFixtureEntry {
  readonly name: string;
  readonly data: string | Buffer;
}

async function createXlsxFixture(extraEntries: readonly ZipFixtureEntry[] = []): Promise<Buffer> {
  const entries: ZipFixtureEntry[] = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>` },
    { name: "_rels/.rels", data: relationships([
      '<Relationship Id="rIdRoot" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    ]) },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <workbookPr date1904="0"/>
        <sheets>
          <sheet name="Second" sheetId="2" r:id="rId2"/>
          <sheet name="First" sheetId="1" r:id="rId1"/>
        </sheets>
        <calcPr calcMode="manual"/>
      </workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: relationships([
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>',
      '<Relationship Id="rIdStrings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]) },
    { name: "xl/sharedStrings.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>shared value</t></si></sst>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs>
      </styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: worksheet([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Only column</t></is></c></row>',
      '<row r="2"><c r="A2" t="s"><v>0</v></c></row>'
    ]) },
    { name: "xl/worksheets/sheet2.xml", data: worksheet([
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Label</t></is></c><c r="B1" t="inlineStr"><is><t>When</t></is></c><c r="C1" t="inlineStr"><is><t>Pending</t></is></c></row>',
      '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1"><f>SUM(1,1)</f><v>45200</v></c><c r="C2"><f t="shared" si="0"/></c></row>'
    ]) },
    ...extraEntries
  ];
  return createZip(entries);
}

function relationships(items: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
}

function worksheet(rows: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

async function createZip(entries: readonly ZipFixtureEntry[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const entry of entries) {
    zip.addBuffer(typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data, entry.name, {
      compress: true,
      mtime: new Date("2026-07-13T00:00:00.000Z"),
      mode: 0o100644
    });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
