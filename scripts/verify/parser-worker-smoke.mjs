import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { Worker } from "node:worker_threads";
import { ZipFile } from "yazl";

const root = process.cwd();
const builtAppRoot = process.env.PIGE_BUILT_APP_ROOT
  ? path.resolve(process.env.PIGE_BUILT_APP_ROOT)
  : path.join(root, "apps/desktop");
const pdfWorkerPath = path.join(builtAppRoot, "out/main/workers/pdf-parser-worker.js");
const pdfPageRendererWorkerPath = path.join(builtAppRoot, "out/main/workers/pdf-page-renderer-worker.js");
const officeWorkerPath = path.join(builtAppRoot, "out/main/workers/office-parser-worker.js");
const webWorkerPath = path.join(builtAppRoot, "out/main/workers/web-extractor-worker.js");
const datasetWorkerPath = path.join(builtAppRoot, "out/main/workers/dataset-ingest-worker.js");
const datasetQueryWorkerPath = path.join(builtAppRoot, "out/main/workers/dataset-query-worker.js");
const datasetQuerySmokeIds = Object.freeze({
  dataset: "dataset_20260713_workersmoke01",
  revision: "dataset_rev_20260713_workersmoke01",
  table: "table_workersmoke01",
  nameColumn: "column_workersmokename",
  cohortColumn: "column_workersmokecohort",
  amountColumn: "column_workersmokeamount"
});

for (const workerPath of [
  pdfWorkerPath,
  pdfPageRendererWorkerPath,
  officeWorkerPath,
  webWorkerPath,
  datasetWorkerPath,
  datasetQueryWorkerPath
]) {
  if (!fs.existsSync(workerPath)) {
    console.error(`Missing built parser worker: ${path.relative(root, workerPath)}. Run npm run build first.`);
    process.exit(1);
  }
}

await expectWorkerError(pdfWorkerPath, {
  requestId: "pdf-worker-smoke",
  filePath: path.join(root, ".missing-parser-worker-smoke.pdf"),
  limits: { maxBytes: 1024, maxPages: 1 }
}, "parser.pdf.source_missing");

const rendererSmokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pdf-renderer-smoke-"));
try {
  const rendererSmokePdf = path.join(rendererSmokeRoot, "vector-page.pdf");
  fs.writeFileSync(rendererSmokePdf, createVectorPdf());
  await expectWorkerSuccess(pdfPageRendererWorkerPath, {
    protocolVersion: 1,
    requestId: "pdf-page-renderer-worker-smoke",
    filePath: rendererSmokePdf,
    pageCandidates: [1],
    limits: {
      maxPdfBytes: 1024 * 1024,
      maxPages: 1,
      maxEdge: 256,
      maxPixelsPerPage: 65_536,
      maxPngBytesPerPage: 1024 * 1024,
      maxTotalPngBytes: 1024 * 1024
    }
  }, (response) => {
    const page = response.result?.pages?.[0];
    return response.protocolVersion === 1 &&
      response.result?.rendererId === "pdfjs_napi_canvas" &&
      response.result?.rendererVersion === "pdfjs-dist@6.1.200+@napi-rs/canvas@1.0.2" &&
      response.result?.renderedPages?.[0] === 1 &&
      page?.locator === "page:1" &&
      page?.png instanceof Uint8Array &&
      hasPngSignature(page.png) &&
      page.width > 0 &&
      page.height > 0;
  });
} finally {
  fs.rmSync(rendererSmokeRoot, { recursive: true, force: true });
}

await expectWorkerError(officeWorkerPath, {
  requestId: "office-worker-smoke",
  filePath: path.join(root, ".missing-parser-worker-smoke.docx"),
  sourceKind: "docx_file",
  limits: {
    maxBytes: 1024,
    maxEntries: 10,
    maxUncompressedBytes: 1024,
    maxXmlEntryBytes: 1024,
    maxSelectedXmlBytes: 1024,
    maxSlides: 1,
    maxTextCharacters: 1024
  }
}, "parser.office.source_missing");

const officeMediaSmokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-office-media-smoke-"));
try {
  const media = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const pptxPath = path.join(officeMediaSmokeRoot, "media.pptx");
  fs.writeFileSync(pptxPath, await createZip([{ name: "ppt/media/image1.png", data: media }]));
  await expectWorkerSuccess(officeWorkerPath, {
    operation: "materialize_pptx_media",
    requestId: "office-media-worker-smoke",
    filePath: pptxPath,
    sourceKind: "pptx_file",
    targets: [{
      slide: 1,
      parentLocator: "slide:1",
      mediaIndex: 1,
      locator: "slide:1/media:1",
      packagePath: "ppt/media/image1.png",
      size: media.length,
      extension: ".png"
    }],
    limits: {
      maxBytes: 1024 * 1024,
      maxEntries: 10,
      maxUncompressedBytes: 1024 * 1024,
      maxTargets: 1,
      maxBytesPerItem: 1024 * 1024,
      maxTotalBytes: 1024 * 1024
    }
  }, (response) => {
    const item = response.result?.media?.[0];
    return response.operation === "materialize_pptx_media" &&
      response.result?.materializerId === "office_openxml_media" &&
      response.result?.materializerVersion === "1" &&
      item?.locator === "slide:1/media:1" &&
      item?.bytes instanceof Uint8Array &&
      Buffer.from(item.bytes).equals(media);
  });
} finally {
  fs.rmSync(officeMediaSmokeRoot, { recursive: true, force: true });
}

await expectWorkerSuccess(webWorkerPath, {
  requestId: "web-worker-smoke",
  html: "<!doctype html><html><head><title>Worker smoke</title></head><body><main><h1>Worker smoke</h1><p>The bundled web extractor returns local readable text without executing page scripts or loading resources.</p></main></body></html>",
  url: "https://example.com/worker-smoke",
  limits: {
    maxInputCharacters: 1024 * 1024,
    maxElements: 1000,
    maxOutputCharacters: 10000,
    maxImageReferences: 8
  }
}, (response) => response.result?.text?.includes("bundled web extractor"));

const datasetSmokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-worker-smoke-"));
try {
  const csvPath = path.join(datasetSmokeRoot, "records.csv");
  fs.writeFileSync(csvPath, "name,count\nAda,3\nGrace,5\n", "utf8");
  await expectWorkerSuccess(datasetWorkerPath, {
    requestId: "dataset-worker-smoke",
    filePath: csvPath,
    sourceKind: "csv_file",
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
    }
  }, (response) => response.plan?.source?.kind === "csv_file" &&
    response.plan?.stats?.tableCount === 1 &&
    response.plan?.stats?.rowCount === 2 &&
    response.plan?.target?.profile === "managed_collection");
} finally {
  fs.rmSync(datasetSmokeRoot, { recursive: true, force: true });
}

const datasetQuerySmokeLimits = Object.freeze({
  maxCatalogDirectoryEntries: 256,
  maxCatalogDatasets: 16,
  maxCatalogTables: 32,
  maxCatalogColumns: 128,
  maxBundleEntries: 4096,
  maxJsonBytes: 8 * 1024 * 1024,
  maxSourceRecordBytes: 1024 * 1024,
  maxPayloadBytes: 512 * 1024 * 1024,
  maxSelectedColumns: 12,
  maxFilters: 8,
  maxGroupByColumns: 2,
  maxAggregates: 8,
  maxOrderBy: 2,
  maxReferencedColumns: 24,
  maxFilterTextBytes: 4 * 1024,
  maxResultRows: 50,
  maxResultColumns: 32,
  maxResultBytes: 64 * 1024,
  maxCellBytes: 4 * 1024,
  maxScanRows: 100000,
  maxScanCells: 500000,
  maxScanBytes: 32 * 1024 * 1024,
  maxGroups: 1000,
  timeoutMs: 30000,
  workerOldGenerationMb: 256
});
const datasetQuerySmokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-dataset-query-worker-smoke-"));
try {
  const payloadPath = path.join(datasetQuerySmokeRoot, "collection.sqlite");
  createDatasetQuerySmokePayload(payloadPath);
  const request = {
    schemaVersion: 1,
    requestId: "dataset-query-worker-success-smoke",
    payloadPath,
    binding: {
      datasetId: datasetQuerySmokeIds.dataset,
      revisionId: datasetQuerySmokeIds.revision,
      schemaChecksum: `sha256:${"a".repeat(64)}`,
      payloadChecksum: checksumFile(payloadPath)
    },
    table: {
      id: datasetQuerySmokeIds.table,
      name: "Worker smoke",
      rowCount: 3,
      columnCount: 3
    },
    columns: [
      { id: datasetQuerySmokeIds.nameColumn, name: "Name", ordinal: 0, logicalType: "string" },
      { id: datasetQuerySmokeIds.cohortColumn, name: "Cohort", ordinal: 1, logicalType: "string" },
      { id: datasetQuerySmokeIds.amountColumn, name: "Amount", ordinal: 2, logicalType: "integer" }
    ],
    plan: {
      selectColumnIds: [datasetQuerySmokeIds.nameColumn, datasetQuerySmokeIds.amountColumn],
      filters: [{ columnId: datasetQuerySmokeIds.cohortColumn, op: "eq", value: "keep" }],
      groupByColumnIds: [],
      aggregates: [],
      orderBy: [{ by: datasetQuerySmokeIds.amountColumn, direction: "desc" }],
      limit: 2
    },
    limits: datasetQuerySmokeLimits
  };
  const planHash = canonicalHash("pige:dataset-query-plan:v1", {
    schemaVersion: request.schemaVersion,
    datasetId: request.binding.datasetId,
    revisionId: request.binding.revisionId,
    schemaChecksum: request.binding.schemaChecksum,
    payloadChecksum: request.binding.payloadChecksum,
    tableId: request.table.id,
    selectColumnIds: request.plan.selectColumnIds,
    filters: request.plan.filters,
    groupByColumnIds: request.plan.groupByColumnIds,
    aggregates: request.plan.aggregates,
    orderBy: request.plan.orderBy,
    limit: request.plan.limit
  });
  const expectedWithoutHash = {
    planHash,
    columns: [
      {
        key: datasetQuerySmokeIds.nameColumn,
        label: "Name",
        logicalType: "string",
        sourceColumnId: datasetQuerySmokeIds.nameColumn
      },
      {
        key: datasetQuerySmokeIds.amountColumn,
        label: "Amount",
        logicalType: "integer",
        sourceColumnId: datasetQuerySmokeIds.amountColumn
      }
    ],
    rows: [
      {
        rowId: "row_workersmokelin",
        ordinal: 2,
        sourceRow: 4,
        values: ["Lin", "7"],
        states: ["value", "value"]
      },
      {
        rowId: "row_workersmokeada",
        ordinal: 0,
        sourceRow: 2,
        values: ["Ada", "3"],
        states: ["value", "value"]
      }
    ],
    sourceMatchedRowCount: 2,
    matchedRowCount: 2,
    returnedRowCount: 2,
    truncated: false,
    usedColumnIds: [
      datasetQuerySmokeIds.nameColumn,
      datasetQuerySmokeIds.cohortColumn,
      datasetQuerySmokeIds.amountColumn
    ],
    returnedRowIds: ["row_workersmokelin", "row_workersmokeada"],
    range: { startRow: 2, endRow: 4 }
  };
  const expectedResult = {
    ...expectedWithoutHash,
    resultHash: canonicalHash("pige:dataset-query-result:v1", expectedWithoutHash)
  };

  await expectWorkerSuccess(datasetQueryWorkerPath, request, (response) =>
    isDeepStrictEqual(response, {
      schemaVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: expectedResult
    })
  );

  const missingRequest = {
    ...request,
    requestId: "dataset-query-worker-missing-payload-smoke",
    payloadPath: path.join(datasetQuerySmokeRoot, "missing.sqlite")
  };
  await expectWorkerError(
    datasetQueryWorkerPath,
    missingRequest,
    "dataset.query.payload_unavailable",
    (response) => isDeepStrictEqual(response, {
      schemaVersion: 1,
      requestId: missingRequest.requestId,
      ok: false,
      error: {
        code: "dataset.query.payload_unavailable",
        message: "The managed Dataset query snapshot is unavailable."
      }
    })
  );
} finally {
  fs.rmSync(datasetQuerySmokeRoot, { recursive: true, force: true });
}

console.log("Built document and web parser workers loaded and returned valid protocol responses. PDF pages and selected PPTX media also materialized as bounded image bytes.");
console.log("Built Dataset worker loaded and returned a valid bounded managed-collection import plan.");
console.log("Built Dataset query worker projected and filtered a fixed-schema private SQLite snapshot with deterministic protocol hashes, then rejected a missing snapshot through its typed protocol.");

async function expectWorkerError(workerPath, request, expectedCode, validate = () => true) {
  const worker = new Worker(pathToFileURL(workerPath), {
    name: `pige-smoke-${request.requestId}`,
    resourceLimits: { maxOldGenerationSizeMb: 512 }
  });
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Worker smoke timed out: ${workerPath}`)), 10_000);
      worker.once("message", (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      worker.once("exit", (code) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Worker exited before its response with code ${code}: ${workerPath}`));
        }
      });
      worker.postMessage(request);
    });
    if (
      !response ||
      response.requestId !== request.requestId ||
      response.ok !== false ||
      response.error?.code !== expectedCode ||
      !validate(response)
    ) {
      throw new Error(`Unexpected worker response from ${workerPath}: ${JSON.stringify(response)}`);
    }
  } finally {
    await worker.terminate();
  }
}

async function expectWorkerSuccess(workerPath, request, validate) {
  const worker = new Worker(pathToFileURL(workerPath), {
    name: `pige-smoke-${request.requestId}`,
    resourceLimits: { maxOldGenerationSizeMb: 512 }
  });
  try {
    const response = await waitForWorker(worker, workerPath, request);
    if (!response || response.requestId !== request.requestId || response.ok !== true || !validate(response)) {
      throw new Error(`Unexpected worker response from ${workerPath}: ${JSON.stringify(response)}`);
    }
  } finally {
    await worker.terminate();
  }
}

function waitForWorker(worker, workerPath, request) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker smoke timed out: ${workerPath}`)), 10_000);
    worker.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Worker exited before its response with code ${code}: ${workerPath}`));
      }
    });
    worker.postMessage(request);
  });
}

function createDatasetQuerySmokePayload(payloadPath) {
  const database = new DatabaseSync(payloadPath);
  try {
    database.exec(`
      CREATE TABLE pige_dataset_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE pige_dataset_tables (
        table_id TEXT PRIMARY KEY,
        ordinal INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_locator TEXT NOT NULL,
        source_metadata_json TEXT NOT NULL,
        header_json TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        column_count INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE pige_dataset_columns (
        column_id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL,
        name TEXT NOT NULL,
        projected_type TEXT NOT NULL,
        source_types_json TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        UNIQUE(table_id, ordinal)
      ) STRICT;
      CREATE TABLE pige_dataset_rows (
        row_id TEXT PRIMARY KEY,
        table_id TEXT NOT NULL REFERENCES pige_dataset_tables(table_id),
        ordinal INTEGER NOT NULL,
        source_row INTEGER NOT NULL,
        UNIQUE(table_id, ordinal)
      ) STRICT;
      CREATE TABLE pige_dataset_cells (
        row_id TEXT NOT NULL REFERENCES pige_dataset_rows(row_id),
        column_id TEXT NOT NULL REFERENCES pige_dataset_columns(column_id),
        state TEXT NOT NULL,
        source_type TEXT NOT NULL,
        lexical_raw TEXT,
        lexical_text TEXT,
        quoted INTEGER,
        projection_kind TEXT NOT NULL,
        projection_json TEXT,
        formula_json TEXT,
        source_style_json TEXT,
        PRIMARY KEY(row_id, column_id)
      ) STRICT;
    `);
    const insertMeta = database.prepare("INSERT INTO pige_dataset_meta VALUES (?, ?)");
    insertMeta.run("format", "pige-managed-collection-v1");
    insertMeta.run("dataset_id", datasetQuerySmokeIds.dataset);
    insertMeta.run("revision_id", datasetQuerySmokeIds.revision);
    insertMeta.run("source_sha256", "c".repeat(64));
    insertMeta.run("planner", "dataset_ingest@1");
    database.prepare("INSERT INTO pige_dataset_tables VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      datasetQuerySmokeIds.table,
      0,
      "Worker smoke",
      "synthetic:worker-smoke",
      "{}",
      JSON.stringify(["Name", "Cohort", "Amount"]),
      3,
      3
    );
    const insertColumn = database.prepare("INSERT INTO pige_dataset_columns VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const [id, ordinal, name, projectedType] of [
      [datasetQuerySmokeIds.nameColumn, 0, "Name", "text"],
      [datasetQuerySmokeIds.cohortColumn, 1, "Cohort", "text"],
      [datasetQuerySmokeIds.amountColumn, 2, "Amount", "integer"]
    ]) {
      insertColumn.run(id, datasetQuerySmokeIds.table, ordinal, name, projectedType, "[]", "{}");
    }
    const insertRow = database.prepare("INSERT INTO pige_dataset_rows VALUES (?, ?, ?, ?)");
    const insertCell = database.prepare("INSERT INTO pige_dataset_cells VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of [
      { id: "row_workersmokeada", ordinal: 0, sourceRow: 2, name: "Ada", cohort: "keep", amount: 3 },
      { id: "row_workersmokegrace", ordinal: 1, sourceRow: 3, name: "Grace", cohort: "skip", amount: 5 },
      { id: "row_workersmokelin", ordinal: 2, sourceRow: 4, name: "Lin", cohort: "keep", amount: 7 }
    ]) {
      insertRow.run(row.id, datasetQuerySmokeIds.table, row.ordinal, row.sourceRow);
      for (const [columnId, value] of [
        [datasetQuerySmokeIds.nameColumn, row.name],
        [datasetQuerySmokeIds.cohortColumn, row.cohort]
      ]) {
        insertCell.run(
          row.id,
          columnId,
          "value",
          "text",
          value,
          value,
          0,
          "text",
          JSON.stringify({ kind: "text", value }),
          null,
          null
        );
      }
      const amount = String(row.amount);
      insertCell.run(
        row.id,
        datasetQuerySmokeIds.amountColumn,
        "value",
        "integer",
        amount,
        amount,
        0,
        "integer",
        JSON.stringify({ kind: "integer", value: amount }),
        null,
        null
      );
    }
  } finally {
    database.close();
  }
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function canonicalHash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function createVectorPdf() {
  const content = "0.2 0.5 0.8 rg 10 10 80 80 re f";
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];
  let size = chunks[0].byteLength;
  for (let index = 0; index < bodies.length; index += 1) {
    offsets.push(size);
    const object = Buffer.from(`${index + 1} 0 obj\n${bodies[index]}\nendobj\n`, "ascii");
    chunks.push(object);
    size += object.byteLength;
  }
  const xrefOffset = size;
  const xref = ["xref\n0 5\n", "0000000000 65535 f \n"];
  for (let index = 1; index <= bodies.length; index += 1) {
    xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join(""), "ascii"));
  return Buffer.concat(chunks);
}

function hasPngSignature(value) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return value.byteLength >= signature.length && signature.every((byte, index) => value[index] === byte);
}

async function createZip(entries) {
  const zip = new ZipFile();
  for (const entry of entries) {
    zip.addBuffer(entry.data, entry.name, {
      compress: true,
      mtime: new Date("2026-07-10T00:00:00.000Z"),
      mode: 0o100644
    });
  }
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
