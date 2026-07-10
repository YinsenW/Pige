import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import {
  PdfOcrArtifactService,
  type PdfPageOcrResult,
  type PdfRenderForOcrInput
} from "../../apps/desktop/src/main/services/pdf-ocr-artifact-service";
import { extractPdfText } from "../../apps/desktop/src/main/services/pdf-parser-core";
import { PdfParserService } from "../../apps/desktop/src/main/services/pdf-parser-service";
import {
  PDF_PARSER_MAX_BYTES,
  PDF_PARSER_MAX_PAGES
} from "../../apps/desktop/src/main/services/pdf-parser-types";
import {
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_VERSION
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { JobRecordSchema, SourceRecordSchema, type JobRecord, type SourceRecord } from "@pige/schemas";
import { createJpegScanPdf } from "./helpers/pdf-image-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";

const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
));
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PDF OCR artifact service", () => {
  it("persists page pixels and OCR evidence once, then reuses checksummed output", async () => {
    const setup = await makeParsedScan(2);
    const service = new PdfOcrArtifactService();
    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(2)
    );
    const stagedRecord = readSourceRecord(setup.sourceRecordPath);
    const parserMetadataId = setup.sourceRecord.artifacts.find((artifact) => artifact.kind === "metadata")?.id;

    expect(staging.pages.map((page) => page.artifactPath)).toEqual([
      `artifacts/rendered-pages/2026/07/${setup.sourceRecord.id}/page-0001.png`,
      `artifacts/rendered-pages/2026/07/${setup.sourceRecord.id}/page-0002.png`
    ]);
    expect(stagedRecord.artifacts.filter((artifact) => artifact.kind === "rendered_page")).toHaveLength(2);
    expect(stagedRecord.artifacts.some((artifact) => artifact.id === parserMetadataId)).toBe(true);
    expect(stagedRecord.metadata.parserStatus).toBe("parsed_needs_ocr");

    const persisted = await service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [pageOcr(1, "Alpha knowledge"), pageOcr(2, "Beta knowledge")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const textArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.kind === "ocr"));
    const ocrMetadata = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_ocr_metadata")));
    const text = fs.readFileSync(path.join(setup.vaultPath, textArtifact.path), "utf8");
    const sidecar = fs.readFileSync(path.join(setup.vaultPath, ocrMetadata.path), "utf8");
    const sourcePage = fs.readFileSync(path.join(setup.vaultPath, requireValue(finalRecord.knowledgePagePath)), "utf8");

    expect(persisted).toMatchObject({ created: true, agentTextReady: true, textCharacterCount: 61 });
    expect(text).toBe("--- Page 1 ---\nAlpha knowledge\n\n--- Page 2 ---\nBeta knowledge\n");
    expect(sidecar).toContain('"locator": "page:1/ocr:block:1"');
    expect(sidecar).toContain('"parentLocator": "page:2"');
    expect(sidecar).not.toContain("Alpha knowledge");
    expect(sidecar).not.toContain("Beta knowledge");
    expect(sourcePage).toContain("Alpha knowledge");
    expect(finalRecord.artifacts[0]?.kind).toBe("ocr");
    expect(finalRecord.artifacts[1]?.id).toMatch(/_pdf_ocr_metadata$/u);
    expect(finalRecord.artifacts.some((artifact) => artifact.id === parserMetadataId)).toBe(true);
    expect(finalRecord.metadata).toMatchObject({
      parserStatus: "parsed_needs_ocr",
      textCoverage: "none",
      ocrStatus: "completed",
      needsOcr: false,
      agentTextReady: true,
      ocrProcessedPages: [1, 2]
    });
    expect(listFiles(path.join(setup.vaultPath, ".pige", "operations"), ".json")).toHaveLength(3);

    const reused = await service.readExisting(
      setup.vaultPath,
      finalRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    );
    expect(reused).toMatchObject({ created: false, agentTextReady: true });
    expect(listFiles(path.join(setup.vaultPath, ".pige", "operations"), ".json")).toHaveLength(3);

    const renderedArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.kind === "rendered_page"));
    fs.writeFileSync(path.join(setup.vaultPath, renderedArtifact.path), Buffer.from("tampered-page"));
    expect(await service.readExisting(
      setup.vaultPath,
      finalRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    )).toBeUndefined();
  });

  it("rejects source changes between rendering and final OCR persistence", async () => {
    const setup = await makeParsedScan(1);
    const service = new PdfOcrArtifactService();
    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(1)
    );
    const sourcePath = path.join(setup.vaultPath, requireValue(setup.sourceRecord.managedCopy?.path));
    const bytes = fs.readFileSync(sourcePath);
    bytes[0] = bytes[0] === 0 ? 1 : bytes[0] - 1;
    fs.writeFileSync(sourcePath, bytes);

    await expect(service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [pageOcr(1, "Changed source must fail")]
    )).rejects.toMatchObject({ code: "source.checksum_mismatch" });
  });

  it("merges OCR output into the latest Source Record instead of a stale staging snapshot", async () => {
    const setup = await makeParsedScan(1);
    const service = new PdfOcrArtifactService();
    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(1)
    );
    const concurrentRecord = readSourceRecord(setup.sourceRecordPath);
    fs.writeFileSync(setup.sourceRecordPath, `${JSON.stringify({
      ...concurrentRecord,
      metadata: { ...concurrentRecord.metadata, concurrentMarker: "preserve-me" },
      updatedAt: "2026-07-10T08:02:00.000Z"
    }, null, 2)}\n`, "utf8");

    await service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [pageOcr(1, "Current record merge")]
    );

    expect(readSourceRecord(setup.sourceRecordPath).metadata).toMatchObject({
      concurrentMarker: "preserve-me",
      ocrStatus: "completed",
      needsOcr: false,
      agentTextReady: true
    });
  });

  it("rejects a detected Source Record update before final OCR replacement", async () => {
    const setup = await makeParsedScan(1);
    const service = new PdfOcrArtifactService();
    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(1)
    );
    const ordinary = pageOcr(1, "Do not overwrite a concurrent record");
    let changed = false;
    const racingResult = {
      page: ordinary.page,
      locator: ordinary.locator,
      get result() {
        if (!changed) {
          changed = true;
          const current = readSourceRecord(setup.sourceRecordPath);
          fs.writeFileSync(setup.sourceRecordPath, `${JSON.stringify({
            ...current,
            metadata: { ...current.metadata, concurrentMarker: "newer-record" },
            updatedAt: "2026-07-10T08:03:00.000Z"
          }, null, 2)}\n`, "utf8");
        }
        return ordinary.result;
      }
    } satisfies PdfPageOcrResult;

    await expect(service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [racingResult]
    )).rejects.toMatchObject({ code: "ocr.pdf.target_changed" });
    expect(readSourceRecord(setup.sourceRecordPath).metadata.concurrentMarker).toBe("newer-record");
  });

  it("rejects rendered-page writes through a parent symlink outside the vault", async () => {
    const setup = await makeParsedScan(1);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pdf-ocr-outside-"));
    tempRoots.push(outside);
    fs.symlinkSync(outside, path.join(setup.vaultPath, "artifacts", "rendered-pages"), "dir");

    await expect(new PdfOcrArtifactService().stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(1)
    )).rejects.toMatchObject({ code: "ocr.path_outside_vault" });
    expect(listFiles(outside, ".png")).toHaveLength(0);
  });

  it("records incomplete and completed render generations without reusing stale provenance", async () => {
    const setup = await makeParsedScan(2);
    const service = new PdfOcrArtifactService();
    const completeInput = renderInput(2);
    await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      { ...completeInput, pages: completeInput.pages.slice(0, 1), truncated: true }
    );
    const afterPartial = readSourceRecord(setup.sourceRecordPath);
    await service.stageRenderedPages(
      setup.vaultPath,
      afterPartial,
      setup.sourceRecordPath,
      setup.ocrJob,
      completeInput
    );

    const operations = listFiles(path.join(setup.vaultPath, ".pige", "operations"), ".json")
      .map((file) => fs.readFileSync(file, "utf8"));
    expect(operations.filter((operation) => operation.includes("Recorded bounded local PDF page artifacts"))).toHaveLength(2);
  });

  it("keeps empty OCR body-free and supports a referenced original PDF", async () => {
    const setup = await makeParsedScan(1);
    const referencedRecord = SourceRecordSchema.parse({
      ...setup.sourceRecord,
      storageStrategy: "reference_original",
      managedCopy: undefined,
      original: {
        ...setup.sourceRecord.original,
        path: setup.originalPath,
        checksum: checksum(fs.readFileSync(setup.originalPath)),
        lastKnownSize: fs.statSync(setup.originalPath).size
      }
    });
    fs.writeFileSync(setup.sourceRecordPath, `${JSON.stringify(referencedRecord, null, 2)}\n`, "utf8");
    const service = new PdfOcrArtifactService();
    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      referencedRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderInput(1)
    );
    const result = await service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [pageOcr(1, "")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const sidecarArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_ocr_metadata")));
    const sidecar = fs.readFileSync(path.join(setup.vaultPath, sidecarArtifact.path), "utf8");

    expect(result).toMatchObject({ agentTextReady: false, textCharacterCount: 0 });
    expect(finalRecord.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(false);
    expect(finalRecord.metadata).toMatchObject({ ocrStatus: "completed_empty", needsOcr: false, agentTextReady: false });
    expect(sidecar).toContain('"sourceLocation": "referenced_original"');
    expect(sidecar).not.toContain(setup.originalPath);
  });

  it("enriches only parser-selected sparse pages while retaining native PDF evidence", async () => {
    const nativeText = "Native PDF knowledge remains independently useful and must stay available while a sparse second page is enriched.";
    const setup = await makeParsedPdf(createTestPdf([nativeText, ""], "Mixed Evidence"), "mixed.pdf");
    const nativeArtifact = requireValue(setup.sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text"));
    const service = new PdfOcrArtifactService();

    const staging = await service.stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderTarget(2, [2])
    );

    expect(staging).toMatchObject({
      targetMode: "enrichment",
      nativeTextReady: true,
      pageCount: 2,
      requestedPages: [2]
    });
    expect(staging.pages.map((page) => page.page)).toEqual([2]);
    expect(staging.sourceRecord.artifacts.some((artifact) => artifact.id === nativeArtifact.id)).toBe(true);
    expect(staging.sourceRecord.metadata).toMatchObject({ agentTextReady: true, needsOcr: true });

    const result = await service.persistOcr(
      setup.vaultPath,
      staging,
      setup.sourceRecordPath,
      setup.ocrJob,
      [pageOcr(2, "")]
    );
    const finalRecord = readSourceRecord(setup.sourceRecordPath);
    const ocrSidecarArtifact = requireValue(finalRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_ocr_metadata")));
    const ocrSidecar = JSON.parse(fs.readFileSync(path.join(setup.vaultPath, ocrSidecarArtifact.path), "utf8")) as Record<string, unknown>;

    expect(result).toMatchObject({ agentTextReady: true, textCharacterCount: 0 });
    expect(finalRecord.artifacts.some((artifact) => artifact.id === nativeArtifact.id)).toBe(true);
    expect(finalRecord.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(false);
    expect(finalRecord.artifacts.filter((artifact) => artifact.kind === "rendered_page").map((artifact) => artifact.id)).toEqual([
      `art_${setup.sourceRecord.id.replace(/^src_/u, "")}_pdf_page_0002`
    ]);
    expect(finalRecord.metadata).toMatchObject({
      textCoverage: "medium",
      ocrStatus: "completed_empty",
      ocrProcessedPages: [2],
      needsOcr: false,
      agentTextReady: true
    });
    expect(ocrSidecar).toMatchObject({
      targetMode: "enrichment",
      nativeTextReady: true,
      requestedPages: [2],
      complete: true,
      ocrTextReady: false,
      agentTextReady: true
    });
    expect(await service.readExisting(
      setup.vaultPath,
      finalRecord,
      setup.sourceRecordPath,
      setup.ocrJob
    )).toMatchObject({ created: false, agentTextReady: true, textCharacterCount: 0 });
  });

  it("rejects parser-sidecar drift before writing selected-page artifacts", async () => {
    const setup = await makeParsedPdf(createTestPdf([
      "This first page contains enough native text to select only the empty second page for OCR.",
      ""
    ]), "tampered-mixed.pdf");
    const parserSidecarArtifact = requireValue(setup.sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_metadata")));
    const parserSidecarPath = path.join(setup.vaultPath, parserSidecarArtifact.path);
    const parserSidecar = JSON.parse(fs.readFileSync(parserSidecarPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(parserSidecarPath, `${JSON.stringify({ ...parserSidecar, ocrCandidatePages: [1] }, null, 2)}\n`, "utf8");

    await expect(new PdfOcrArtifactService().stageRenderedPages(
      setup.vaultPath,
      setup.sourceRecord,
      setup.sourceRecordPath,
      setup.ocrJob,
      renderTarget(2, [2])
    )).rejects.toMatchObject({ code: "ocr.pdf.parser_metadata_invalid" });
    expect(fs.existsSync(path.join(setup.vaultPath, "artifacts", "rendered-pages"))).toBe(false);
  });
});

async function makeParsedScan(pageCount: number): Promise<{
  readonly vaultPath: string;
  readonly originalPath: string;
  readonly sourceRecordPath: string;
  readonly sourceRecord: SourceRecord;
  readonly ocrJob: JobRecord;
}> {
  return makeParsedPdf(createJpegScanPdf(pageCount), "scan.pdf");
}

async function makeParsedPdf(bytes: Uint8Array, fileName: string): Promise<{
  readonly vaultPath: string;
  readonly originalPath: string;
  readonly sourceRecordPath: string;
  readonly sourceRecord: SourceRecord;
  readonly ocrJob: JobRecord;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pdf-ocr-artifacts-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "Vault");
  const vault = loadVaultSummary(vaultPath);
  const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
  const capture = new CaptureService(vaultPort);
  const parser = new PdfParserService({
    isAvailable: () => true,
    extract: (filePath) => extractPdfText({
      requestId: "pdf-ocr-artifact-test",
      filePath,
      limits: { maxBytes: PDF_PARSER_MAX_BYTES, maxPages: PDF_PARSER_MAX_PAGES }
    })
  });
  const jobs = new JobsService(vaultPort, undefined, undefined, parser);
  const originalPath = path.join(root, fileName);
  fs.writeFileSync(originalPath, bytes);
  const captured = await capture.submitFiles({
    filePaths: [originalPath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(captured.sourceIds[0]);
  jobs.processQueuedCaptures({ jobIds: captured.jobIds });
  await jobs.processQueuedParses({ sourceIds: [sourceId] });
  const sourceRecordPath = requireValue(listFiles(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`)[0]);
  const sourceRecord = readSourceRecord(sourceRecordPath);
  const ocrJob = JobRecordSchema.parse({
    id: `job_20260710_${"pdfocr".padEnd(12, "0")}`,
    class: "ocr",
    state: "running",
    createdAt: "2026-07-10T08:01:00.000Z",
    updatedAt: "2026-07-10T08:01:00.000Z",
    sourceId,
    message: "Testing durable PDF page OCR artifacts."
  });
  return { vaultPath, originalPath, sourceRecordPath, sourceRecord, ocrJob };
}

function renderInput(pageCount: number): PdfRenderForOcrInput {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  return renderTarget(pageCount, pages);
}

function renderTarget(pageCount: number, pages: readonly number[]): PdfRenderForOcrInput {
  return {
    rendererId: PDF_PAGE_RENDERER_ID,
    rendererVersion: PDF_PAGE_RENDERER_VERSION,
    pageCount,
    requestedPages: pages,
    pages: pages.map((page) => ({ page, locator: `page:${page}`, png: Uint8Array.from(ONE_PIXEL_PNG), width: 1, height: 1 })),
    warnings: [],
    truncated: false
  };
}

function pageOcr(page: number, text: string): PdfPageOcrResult {
  const result: NativeOcrResult = {
    engine: "macos_vision_document",
    engineVersion: "macos-26",
    adapterVersion: "1.0.0",
    text,
    blocks: text ? [{
      text,
      kind: "line",
      confidence: 0.92,
      boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 },
      languageHints: ["en"],
      isTitle: false
    }] : [],
    languageHints: text ? ["en"] : [],
    ...(text ? { confidence: 0.92 } : {}),
    warnings: text ? [] : ["ocr_empty_text"],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1,
      sourceHeight: 1,
      decodedWidth: 1,
      decodedHeight: 1,
      downsampled: false
    }
  };
  return { page, locator: `page:${page}`, result };
}

function readSourceRecord(filePath: string): SourceRecord {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(child, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(child);
  }
  return files.sort();
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value.");
  return value;
}
