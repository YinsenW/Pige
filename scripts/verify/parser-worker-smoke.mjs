import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { ZipFile } from "yazl";

const root = process.cwd();
const pdfWorkerPath = path.join(root, "apps/desktop/out/main/workers/pdf-parser-worker.js");
const pdfPageRendererWorkerPath = path.join(root, "apps/desktop/out/main/workers/pdf-page-renderer-worker.js");
const officeWorkerPath = path.join(root, "apps/desktop/out/main/workers/office-parser-worker.js");
const webWorkerPath = path.join(root, "apps/desktop/out/main/workers/web-extractor-worker.js");

for (const workerPath of [pdfWorkerPath, pdfPageRendererWorkerPath, officeWorkerPath, webWorkerPath]) {
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

console.log("Built document and web parser workers loaded and returned valid protocol responses. PDF pages and selected PPTX media also materialized as bounded image bytes.");

async function expectWorkerError(workerPath, request, expectedCode) {
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
    if (!response || response.requestId !== request.requestId || response.ok !== false || response.error?.code !== expectedCode) {
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
