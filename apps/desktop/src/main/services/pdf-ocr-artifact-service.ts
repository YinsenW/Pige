import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import type { OcrSourceResult } from "./ocr-artifact-service";
import {
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_MAX_EDGE,
  PDF_PAGE_RENDERER_MAX_PAGES,
  PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES,
  PDF_PAGE_RENDERER_VERSION,
  type PdfPageRendererWarning
} from "./pdf-page-renderer-types";
import {
  PDF_PARSER_ENGINE,
  PDF_PARSER_ID,
  PDF_PARSER_VERSION,
  type PdfTextCoverage
} from "./pdf-parser-types";
import { SourcePageService } from "./source-page-service";
import { tryVerifyReadableSourceFileAsync, verifyReadableSourceFileAsync } from "./source-file-access";
import { MACOS_VISION_OCR_ADAPTER_VERSION, type NativeOcrResult } from "./ocr-types";

export interface PdfRenderedPageForOcr {
  readonly page: number;
  readonly locator: string;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface PdfRenderForOcrInput {
  readonly rendererId: typeof PDF_PAGE_RENDERER_ID;
  readonly rendererVersion: typeof PDF_PAGE_RENDERER_VERSION;
  readonly pageCount: number;
  readonly requestedPages: readonly number[];
  readonly pages: readonly PdfRenderedPageForOcr[];
  readonly warnings: readonly PdfPageRendererWarning[];
  readonly truncated: boolean;
}

export interface PdfOcrTargetReady {
  readonly ready: true;
  readonly mode: "image_only" | "enrichment";
  readonly pageCount: number;
  readonly pages: readonly number[];
  readonly message: string;
}

export interface PdfOcrTargetWaiting {
  readonly ready: false;
  readonly message: string;
}

export type PdfOcrTargetInspection = PdfOcrTargetReady | PdfOcrTargetWaiting;

export interface VerifiedPdfOcrTarget extends PdfOcrTargetReady {
  readonly parserMetadataArtifactId: string;
  readonly parserMetadataChecksum: string;
  readonly nativeTextReady: boolean;
}

export interface PdfStagedOcrPage {
  readonly page: number;
  readonly locator: string;
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly absolutePath: string;
  readonly checksum: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface PdfOcrStagingResult {
  readonly sourceRecord: SourceRecord;
  readonly targetMode: VerifiedPdfOcrTarget["mode"];
  readonly parserMetadataArtifactId: string;
  readonly parserMetadataChecksum: string;
  readonly nativeTextReady: boolean;
  readonly renderMetadataArtifactId: string;
  readonly renderMetadataArtifactPath: string;
  readonly renderMetadataChecksum: string;
  readonly pageCount: number;
  readonly requestedPages: readonly number[];
  readonly pages: readonly PdfStagedOcrPage[];
  readonly warnings: readonly string[];
  readonly truncated: boolean;
}

export interface PdfPageOcrResult {
  readonly page: number;
  readonly locator: string;
  readonly result: NativeOcrResult;
}

interface FileIntegrity {
  readonly checksum: string;
  readonly size: number;
}

interface SourceRecordSnapshot {
  readonly sourceRecord: SourceRecord;
  readonly fileChecksum: string;
}

interface AssembledPdfOcr {
  readonly text: string;
  readonly units: readonly Record<string, unknown>[];
  readonly pages: readonly Record<string, unknown>[];
  readonly confidence?: number;
  readonly languageHints: readonly string[];
  readonly warnings: readonly string[];
  readonly blockCount: number;
}

const MAX_PDF_OCR_SIDECAR_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_RECORD_BYTES = 16 * 1024 * 1024;

export function inspectPdfOcrTarget(sourceRecord: SourceRecord): PdfOcrTargetInspection {
  const metadata = sourceRecord.metadata;
  if (metadata.parserFormat !== "pdf" || (metadata.parserStatus !== "parsed_needs_ocr" && metadata.parserStatus !== "parsed")) {
    return { ready: false, message: "PDF OCR is waiting for verified local text extraction metadata." };
  }
  if (metadata.parserTruncated === true) {
    return { ready: false, message: "PDF OCR is waiting because the parser did not inspect the complete document." };
  }
  const pageCount = positiveInteger(metadata.pageCount);
  const processedPageCount = positiveInteger(metadata.processedPageCount);
  const pages = positiveIntegerArray(metadata.ocrCandidatePages);
  const textCoverage = metadata.textCoverage;
  if (
    pageCount === undefined ||
    processedPageCount !== pageCount ||
    !isPdfTextCoverage(textCoverage) ||
    pages.length === 0 ||
    pages.some((page) => page > pageCount)
  ) {
    return {
      ready: false,
      message: "PDF OCR is waiting for a complete, ordered candidate-page set from the verified parser output."
    };
  }
  if (textCoverage === "none" && (pages.length !== pageCount || pages.some((page, index) => page !== index + 1))) {
    return {
      ready: false,
      message: "Image-only PDF OCR is waiting for a complete, ordered image-page target list from the parser."
    };
  }
  if (pages.length > PDF_PAGE_RENDERER_MAX_PAGES) {
    return {
      ready: false,
      message: `This PDF has ${pages.length} OCR candidate pages; bounded local OCR currently supports at most ${PDF_PAGE_RENDERER_MAX_PAGES} pages per durable job.`
    };
  }
  const mode = textCoverage === "none" ? "image_only" : "enrichment";
  return {
    ready: true,
    mode,
    pageCount,
    pages,
    message: mode === "image_only"
      ? "Image-only PDF is ready for local page OCR."
      : "Mixed-text PDF is ready for bounded OCR enrichment of parser-selected pages."
  };
}

export class PdfOcrArtifactService {
  readonly #sourcePages: SourcePageService;

  constructor(sourcePages = new SourcePageService()) {
    this.#sourcePages = sourcePages;
  }

  async resolveTarget(vaultPath: string, sourceRecord: SourceRecord): Promise<VerifiedPdfOcrTarget> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind !== "pdf_file") {
      throw new PigeDomainError("ocr.pdf.source_unsupported", "PDF OCR accepts preserved PDF sources only.");
    }
    const inspection = inspectPdfOcrTarget(parsedSource);
    if (!inspection.ready) {
      throw new PigeDomainError("ocr.pdf.target_not_ready", inspection.message);
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const parserMetadataArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === pdfParserMetadataArtifactId(parsedSource.id) && artifact.kind === "metadata"
    );
    if (!parserMetadataArtifact?.checksum || parserMetadataArtifact.size === undefined) {
      throw new PigeDomainError("ocr.pdf.parser_metadata_invalid", "The PDF OCR target has no verified parser metadata Artifact.");
    }
    const parserSidecar = await readVerifiedJsonArtifact(
      vaultPath,
      parserMetadataArtifact,
      MAX_PDF_OCR_SIDECAR_BYTES
    );
    if (!isVerifiedPdfParserSidecar(parserSidecar, parsedSource, sourceFile.checksum, inspection)) {
      throw new PigeDomainError("ocr.pdf.parser_metadata_invalid", "The PDF OCR target does not match the verified parser metadata.");
    }
    const nativeTextReady = parserSidecar.agentTextReady === true;
    const nativeTextArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === pdfParserTextArtifactId(parsedSource.id) && artifact.kind === "extracted_text"
    );
    if (typeof parserSidecar.extractedTextChecksum === "string") {
      if (
        !nativeTextArtifact ||
        nativeTextArtifact.checksum !== parserSidecar.extractedTextChecksum ||
        !await artifactFileMatches(vaultPath, nativeTextArtifact)
      ) {
        throw new PigeDomainError("ocr.pdf.parser_metadata_invalid", "The native PDF text selected for enrichment failed integrity verification.");
      }
    } else if (nativeTextArtifact || nativeTextReady) {
      throw new PigeDomainError("ocr.pdf.parser_metadata_invalid", "The PDF parser text readiness state has no matching verified text Artifact.");
    }
    return {
      ...inspection,
      parserMetadataArtifactId: parserMetadataArtifact.id,
      parserMetadataChecksum: parserMetadataArtifact.checksum,
      nativeTextReady
    };
  }

  async readExisting(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    onPublicationStart?: () => void
  ): Promise<OcrSourceResult | undefined> {
    if (sourceRecord.kind !== "pdf_file") return undefined;
    const target = await this.resolveTarget(vaultPath, sourceRecord);
    const sourceFile = await tryVerifyReadableSourceFileAsync(vaultPath, sourceRecord);
    if (!sourceFile) return undefined;
    const metadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === pdfOcrMetadataArtifactId(sourceRecord.id) && artifact.kind === "metadata"
    );
    const renderMetadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === pdfRenderMetadataArtifactId(sourceRecord.id) && artifact.kind === "metadata"
    );
    if (
      !metadataArtifact ||
      !renderMetadataArtifact ||
      !metadataArtifact.checksum ||
      !renderMetadataArtifact.checksum
    ) return undefined;
    const textArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === pdfOcrTextArtifactId(sourceRecord.id) && artifact.kind === "ocr"
    );
    if (textArtifact && !await artifactFileMatches(vaultPath, textArtifact)) return undefined;
    const sidecar = await readVerifiedJsonArtifact(vaultPath, metadataArtifact, MAX_PDF_OCR_SIDECAR_BYTES);
    const renderSidecar = await readVerifiedJsonArtifact(vaultPath, renderMetadataArtifact, MAX_PDF_OCR_SIDECAR_BYTES);
    if (!isReusablePdfOcrSidecar(
      sidecar,
      sourceRecord,
      sourceFile.checksum,
      renderMetadataArtifact,
      textArtifact,
      target
    ) || !isReusablePdfRenderSidecar(renderSidecar, sourceRecord, sourceFile.checksum, target)) return undefined;
    if (!await renderedArtifactsMatch(vaultPath, sourceRecord, sidecar.pages as readonly unknown[])) return undefined;

    onPublicationStart?.();
    const page = this.#sourcePages.refreshForSource(vaultPath, sourceRecord, sourceRecordPath, job.id);
    const storedWarnings = stringArray(sidecar.warnings);
    const warnings = page.conflict ? [...storedWarnings, sourcePageConflictWarning()] : storedWarnings;
    writeRenderOperation(vaultPath, sourceRecord, job, storedWarnings);
    writePdfOcrOperation(vaultPath, sourceRecord, job, warnings);
    const confidence = normalizedNumber(sidecar.confidence);
    return {
      sourceId: sourceRecord.id,
      created: false,
      ...(textArtifact ? { ocrTextArtifactPath: textArtifact.path } : {}),
      metadataArtifactPath: metadataArtifact.path,
      textCharacterCount: nonNegativeInteger(sidecar.textCharacterCount),
      ...(confidence !== undefined ? { confidence } : {}),
      agentTextReady: sidecar.agentTextReady === true,
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }

  async stageRenderedPages(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    input: PdfRenderForOcrInput
  ): Promise<PdfOcrStagingResult> {
    const requestedSource = SourceRecordSchema.parse(sourceRecord);
    if (requestedSource.kind !== "pdf_file") {
      throw new PigeDomainError("ocr.pdf.source_unsupported", "PDF OCR accepts preserved PDF sources only.");
    }
    validateRenderInput(input);
    const currentSource = await readCurrentSourceRecord(vaultPath, sourceRecordPath, requestedSource.id);
    const parsedSource = currentSource.sourceRecord;
    const target = await this.resolveTarget(vaultPath, parsedSource);
    if (input.pageCount !== target.pageCount || !sameNumberArray(input.requestedPages, target.pages)) {
      throw new PigeDomainError(
        "ocr.pdf.target_changed",
        "The PDF renderer result does not match the verified parser-selected OCR page target."
      );
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const dateBucket = sourceDateBucket(parsedSource.id);
    const pageDirectory = ["artifacts", "rendered-pages", ...dateBucket, parsedSource.id];
    const stagedPages: PdfStagedOcrPage[] = [];
    let totalBytes = 0;
    for (const page of input.pages) {
      validateRenderedPage(page, input);
      totalBytes += page.png.byteLength;
      if (totalBytes > PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES) {
        throw new PigeDomainError("ocr.pdf.rendered_pages_too_large", "Rendered PDF pages exceed the OCR artifact size limit.");
      }
      const artifactPath = [...pageDirectory, `page-${String(page.page).padStart(4, "0")}.png`].join("/");
      const absolutePath = resolveVaultRelativePath(vaultPath, artifactPath);
      await writeBinaryAtomicAsync(absolutePath, page.png, vaultPath);
      const integrity = await fileIntegrity(absolutePath, "ocr.pdf.rendered_page_missing");
      stagedPages.push({
        page: page.page,
        locator: page.locator,
        artifactId: pdfRenderedPageArtifactId(parsedSource.id, page.page),
        artifactPath,
        absolutePath,
        ...integrity,
        width: page.width,
        height: page.height
      });
    }

    const renderMetadataArtifactPath = [
      "artifacts",
      "metadata",
      ...dateBucket,
      `${parsedSource.id}.pdf-render.json`
    ].join("/");
    const now = new Date().toISOString();
    const warningCodes = renderWarningCodes(input.warnings);
    const renderMetadataAbsolutePath = resolveVaultRelativePath(vaultPath, renderMetadataArtifactPath);
    await writeJsonAtomicAsync(renderMetadataAbsolutePath, {
      schemaVersion: 1,
      artifactId: pdfRenderMetadataArtifactId(parsedSource.id),
      sourceId: parsedSource.id,
      kind: "pdf_page_render_metadata",
      createdAt: now,
      sourceChecksum: sourceFile.checksum,
      sourceSize: sourceFile.size,
      sourceLocation: sourceFile.location,
      targetMode: target.mode,
      parserMetadataArtifactId: target.parserMetadataArtifactId,
      parserMetadataChecksum: target.parserMetadataChecksum,
      nativeTextReady: target.nativeTextReady,
      renderer: { id: input.rendererId, version: input.rendererVersion },
      pageCount: input.pageCount,
      requestedPages: input.requestedPages,
      renderedPages: stagedPages.map((page) => page.page),
      pages: stagedPages.map((page) => ({
        page: page.page,
        locator: page.locator,
        artifactId: page.artifactId,
        checksum: page.checksum,
        size: page.size,
        width: page.width,
        height: page.height,
        mimeType: "image/png"
      })),
      truncated: input.truncated,
      warnings: warningCodes
    }, vaultPath);
    const renderMetadataIntegrity = await fileIntegrity(
      renderMetadataAbsolutePath,
      "ocr.pdf.render_metadata_missing"
    );
    const artifacts = upsertRenderedArtifacts(
      parsedSource,
      stagedPages,
      renderMetadataArtifactPath,
      renderMetadataIntegrity
    );
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        ocrStatus: "rendered_waiting_recognition",
        ocrJobId: job.id,
        needsOcr: true,
        agentTextReady: target.nativeTextReady,
        pdfOcrRender: {
          targetMode: target.mode,
          parserMetadataArtifactId: target.parserMetadataArtifactId,
          parserMetadataChecksum: target.parserMetadataChecksum,
          nativeTextReady: target.nativeTextReady,
          rendererId: input.rendererId,
          rendererVersion: input.rendererVersion,
          pageCount: input.pageCount,
          requestedPages: input.requestedPages,
          renderedPages: stagedPages.map((page) => page.page),
          truncated: input.truncated,
          warnings: warningCodes
        }
      },
      updatedAt: now
    });
    await writeSourceRecordAtomic(vaultPath, sourceRecordPath, updatedSource, currentSource.fileChecksum);
    writeRenderOperation(vaultPath, updatedSource, job, warningCodes);
    return {
      sourceRecord: updatedSource,
      targetMode: target.mode,
      parserMetadataArtifactId: target.parserMetadataArtifactId,
      parserMetadataChecksum: target.parserMetadataChecksum,
      nativeTextReady: target.nativeTextReady,
      renderMetadataArtifactId: pdfRenderMetadataArtifactId(parsedSource.id),
      renderMetadataArtifactPath,
      renderMetadataChecksum: renderMetadataIntegrity.checksum,
      pageCount: input.pageCount,
      requestedPages: input.requestedPages,
      pages: stagedPages,
      warnings: warningCodes,
      truncated: input.truncated
    };
  }

  async persistOcr(
    vaultPath: string,
    staging: PdfOcrStagingResult,
    sourceRecordPath: string,
    job: JobRecord,
    pageResults: readonly PdfPageOcrResult[]
  ): Promise<OcrSourceResult> {
    const stagedSource = SourceRecordSchema.parse(staging.sourceRecord);
    if (stagedSource.kind !== "pdf_file") {
      throw new PigeDomainError("ocr.pdf.source_unsupported", "PDF OCR accepts preserved PDF sources only.");
    }
    const currentSource = await readCurrentSourceRecord(vaultPath, sourceRecordPath, stagedSource.id);
    const parsedSource = currentSource.sourceRecord;
    const target = await this.resolveTarget(vaultPath, parsedSource);
    if (
      target.mode !== staging.targetMode ||
      target.parserMetadataArtifactId !== staging.parserMetadataArtifactId ||
      target.parserMetadataChecksum !== staging.parserMetadataChecksum ||
      target.nativeTextReady !== staging.nativeTextReady ||
      target.pageCount !== staging.pageCount ||
      !sameNumberArray(target.pages, staging.requestedPages)
    ) {
      throw new PigeDomainError(
        "ocr.pdf.target_changed",
        "The verified parser-selected OCR page target changed while OCR was running."
      );
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    await verifyStagedPages(vaultPath, parsedSource, staging);
    const results = validatePageOcrResults(staging, pageResults);
    const complete = !staging.truncated &&
      staging.pages.length === staging.requestedPages.length &&
      results.length === staging.requestedPages.length;
    const assembled = assemblePdfOcr(staging, results);
    const dateBucket = sourceDateBucket(parsedSource.id);
    const textArtifactPath = assembled.text.length > 0
      ? ["artifacts", "ocr", ...dateBucket, `${parsedSource.id}.pdf.txt`].join("/")
      : undefined;
    if (textArtifactPath) {
      await writeTextAtomicAsync(resolveVaultRelativePath(vaultPath, textArtifactPath), `${assembled.text}\n`, vaultPath);
    }
    const textIntegrity = textArtifactPath
      ? await fileIntegrity(resolveVaultRelativePath(vaultPath, textArtifactPath), "ocr.pdf.artifact_missing")
      : undefined;
    const metadataArtifactPath = [
      "artifacts",
      "metadata",
      ...dateBucket,
      `${parsedSource.id}.pdf-ocr.json`
    ].join("/");
    const metadataAbsolutePath = resolveVaultRelativePath(vaultPath, metadataArtifactPath);
    const now = new Date().toISOString();
    const warnings = uniqueWarnings([
      ...staging.warnings,
      ...assembled.warnings,
      ...(!complete ? ["ocr_render_or_page_set_incomplete"] : [])
    ]);
    const ocrTextReady = complete && Boolean(textIntegrity);
    const agentTextReady = complete && (target.nativeTextReady || ocrTextReady);
    await writeJsonAtomicAsync(metadataAbsolutePath, {
      schemaVersion: 1,
      artifactId: pdfOcrMetadataArtifactId(parsedSource.id),
      sourceId: parsedSource.id,
      kind: "pdf_page_ocr_metadata",
      createdAt: now,
      sourceChecksum: sourceFile.checksum,
      sourceSize: sourceFile.size,
      sourceLocation: sourceFile.location,
      targetMode: target.mode,
      parserMetadataArtifactId: target.parserMetadataArtifactId,
      parserMetadataChecksum: target.parserMetadataChecksum,
      nativeTextReady: target.nativeTextReady,
      renderMetadataArtifactId: staging.renderMetadataArtifactId,
      renderMetadataChecksum: staging.renderMetadataChecksum,
      requestedPages: staging.requestedPages,
      adapter: { id: "macos_vision_ocr", version: MACOS_VISION_OCR_ADAPTER_VERSION },
      ...(textIntegrity ? { ocrTextChecksum: textIntegrity.checksum } : {}),
      textCharacterCount: assembled.text.length,
      blockCount: assembled.blockCount,
      ...(assembled.confidence !== undefined ? { confidence: assembled.confidence } : {}),
      languageHints: assembled.languageHints,
      complete,
      ocrTextReady,
      agentTextReady,
      pages: assembled.pages,
      units: assembled.units,
      warnings
    }, vaultPath);
    const metadataIntegrity = await fileIntegrity(metadataAbsolutePath, "ocr.pdf.artifact_missing");
    const artifacts = upsertPdfOcrArtifacts(
      parsedSource,
      textArtifactPath,
      textIntegrity,
      metadataArtifactPath,
      metadataIntegrity
    );
    const engineIds = uniqueStrings(results.map((page) => page.result.engine));
    const engineVersions = uniqueStrings(results.map((page) => page.result.engineVersion));
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        ocrStatus: complete
          ? textArtifactPath ? "completed" : "completed_empty"
          : "partial",
        ocrAdapterId: "macos_vision_ocr",
        ocrAdapterVersion: MACOS_VISION_OCR_ADAPTER_VERSION,
        ocrEngine: engineIds.length === 1 ? engineIds[0] : "mixed_local_ocr",
        ocrEngineVersions: engineVersions,
        ocrJobId: job.id,
        ocrTextCharacterCount: assembled.text.length,
        ocrBlockCount: assembled.blockCount,
        ...(assembled.confidence !== undefined ? { ocrConfidence: assembled.confidence } : {}),
        ocrLanguageHints: assembled.languageHints,
        ocrWarnings: warnings,
        ocrProcessedPages: results.map((page) => page.page),
        needsOcr: !complete,
        agentTextReady,
        ocrCompletedAt: now
      },
      updatedAt: now
    });
    await writeSourceRecordAtomic(vaultPath, sourceRecordPath, updatedSource, currentSource.fileChecksum);
    const page = this.#sourcePages.refreshForSource(vaultPath, updatedSource, sourceRecordPath, job.id);
    const resultWarnings = page.conflict ? [...warnings, sourcePageConflictWarning()] : warnings;
    writePdfOcrOperation(vaultPath, updatedSource, job, resultWarnings);
    return {
      sourceId: parsedSource.id,
      created: true,
      ...(textArtifactPath ? { ocrTextArtifactPath: textArtifactPath } : {}),
      metadataArtifactPath,
      textCharacterCount: assembled.text.length,
      ...(assembled.confidence !== undefined ? { confidence: assembled.confidence } : {}),
      agentTextReady,
      warnings: resultWarnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict
    };
  }
}

function validateRenderInput(input: PdfRenderForOcrInput): void {
  if (
    input.rendererId !== PDF_PAGE_RENDERER_ID ||
    input.rendererVersion !== PDF_PAGE_RENDERER_VERSION ||
    !isPositiveInteger(input.pageCount) ||
    !isSortedUniquePages(input.requestedPages) ||
    input.requestedPages.some((page) => page > input.pageCount) ||
    !Array.isArray(input.pages) ||
    input.pages.length > input.requestedPages.length ||
    !Array.isArray(input.warnings) ||
    typeof input.truncated !== "boolean"
  ) {
    throw new PigeDomainError("ocr.pdf.render_result_invalid", "The PDF page renderer result is invalid.");
  }
  const renderedPages = input.pages.map((page) => page.page);
  if (
    (renderedPages.length > 0 && !isSortedUniquePages(renderedPages)) ||
    renderedPages.some((page) => !input.requestedPages.includes(page))
  ) {
    throw new PigeDomainError("ocr.pdf.render_result_invalid", "The rendered PDF page set is invalid.");
  }
  if (input.truncated !== (renderedPages.length !== input.requestedPages.length)) {
    throw new PigeDomainError("ocr.pdf.render_result_invalid", "The PDF renderer truncation state is inconsistent.");
  }
}

function validateRenderedPage(page: PdfRenderedPageForOcr, input: PdfRenderForOcrInput): void {
  if (
    !isPositiveInteger(page.page) ||
    page.locator !== `page:${page.page}` ||
    !input.requestedPages.includes(page.page) ||
    !(page.png instanceof Uint8Array) ||
    !isPositiveInteger(page.width) ||
    !isPositiveInteger(page.height) ||
    page.width > PDF_PAGE_RENDERER_MAX_EDGE ||
    page.height > PDF_PAGE_RENDERER_MAX_EDGE ||
    page.width > Math.floor(PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE / page.height) ||
    page.png.byteLength > PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE ||
    !hasMatchingPngHeader(page.png, page.width, page.height)
  ) {
    throw new PigeDomainError("ocr.pdf.rendered_page_invalid", "A rendered PDF page is not a valid bounded PNG.");
  }
}

function validatePageOcrResults(
  staging: PdfOcrStagingResult,
  pageResults: readonly PdfPageOcrResult[]
): readonly PdfPageOcrResult[] {
  const sorted = [...pageResults].sort((left, right) => left.page - right.page);
  if (
    sorted.length !== pageResults.length ||
    !isSortedUniquePages(sorted.map((page) => page.page)) ||
    sorted.some((page) => page.locator !== `page:${page.page}` || !staging.pages.some((target) => target.page === page.page))
  ) {
    throw new PigeDomainError("ocr.pdf.result_invalid", "The PDF OCR page result set is invalid.");
  }
  for (const page of sorted) {
    if (
      page.result.adapterVersion !== MACOS_VISION_OCR_ADAPTER_VERSION ||
      page.result.text !== page.result.blocks.map((block) => block.text).join("\n")
    ) {
      throw new PigeDomainError("ocr.pdf.result_invalid", "A PDF page OCR result is inconsistent.");
    }
  }
  return sorted;
}

function assemblePdfOcr(
  staging: PdfOcrStagingResult,
  pageResults: readonly PdfPageOcrResult[]
): AssembledPdfOcr {
  const chunks: string[] = [];
  const units: Record<string, unknown>[] = [];
  const pages: Record<string, unknown>[] = [];
  const confidences: number[] = [];
  const languageHints: string[] = [];
  const warnings: string[] = [];
  let characterCursor = 0;
  let blockCount = 0;
  for (const pageResult of pageResults) {
    const renderedPage = staging.pages.find((page) => page.page === pageResult.page);
    if (!renderedPage) continue;
    const result = pageResult.result;
    const pageWarnings = uniqueWarnings(result.warnings);
    warnings.push(...pageWarnings);
    languageHints.push(...result.languageHints);
    if (result.confidence !== undefined) confidences.push(result.confidence);
    if (result.text.length > 0) {
      if (chunks.length > 0) characterCursor += 2;
      const header = `--- Page ${pageResult.page} ---\n`;
      characterCursor += header.length;
      for (let index = 0; index < result.blocks.length; index += 1) {
        const block = result.blocks[index];
        if (!block) continue;
        const characterStart = characterCursor;
        const characterEnd = characterStart + block.text.length;
        units.push({
          locator: `page:${pageResult.page}/ocr:block:${index + 1}`,
          parentLocator: pageResult.locator,
          renderedArtifactId: renderedPage.artifactId,
          characterStart,
          characterEnd,
          kind: block.kind,
          confidence: block.confidence,
          boundingBox: block.boundingBox,
          languageHints: block.languageHints,
          isTitle: block.isTitle
        });
        characterCursor = characterEnd + (index < result.blocks.length - 1 ? 1 : 0);
        blockCount += 1;
      }
      chunks.push(`${header}${result.text}`);
    }
    pages.push({
      page: pageResult.page,
      locator: pageResult.locator,
      renderedArtifactId: renderedPage.artifactId,
      renderedChecksum: renderedPage.checksum,
      width: renderedPage.width,
      height: renderedPage.height,
      engine: { id: result.engine, version: result.engineVersion },
      textCharacterCount: result.text.length,
      blockCount: result.blocks.length,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      languageHints: result.languageHints,
      warnings: pageWarnings
    });
  }
  return {
    text: chunks.join("\n\n"),
    units,
    pages,
    ...(confidences.length > 0
      ? { confidence: confidences.reduce((total, value) => total + value, 0) / confidences.length }
      : {}),
    languageHints: uniqueStrings(languageHints),
    warnings: uniqueWarnings(warnings),
    blockCount
  };
}

async function verifyStagedPages(
  vaultPath: string,
  sourceRecord: SourceRecord,
  staging: PdfOcrStagingResult
): Promise<void> {
  const renderMetadata = sourceRecord.artifacts.find((artifact) =>
    artifact.id === staging.renderMetadataArtifactId && artifact.kind === "metadata"
  );
  if (
    !renderMetadata ||
    renderMetadata.path !== staging.renderMetadataArtifactPath ||
    renderMetadata.checksum !== staging.renderMetadataChecksum ||
    !await artifactFileMatches(vaultPath, renderMetadata)
  ) {
    throw new PigeDomainError("ocr.pdf.render_metadata_changed", "The PDF render metadata changed before OCR completed.");
  }
  for (const page of staging.pages) {
    const artifact = sourceRecord.artifacts.find((candidate) => candidate.id === page.artifactId && candidate.kind === "rendered_page");
    if (
      !artifact ||
      artifact.path !== page.artifactPath ||
      artifact.checksum !== page.checksum ||
      artifact.size !== page.size ||
      !await artifactFileMatches(vaultPath, artifact)
    ) {
      throw new PigeDomainError("ocr.pdf.rendered_page_changed", "A rendered PDF page changed before OCR completed.");
    }
  }
}

function isVerifiedPdfParserSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  target: PdfOcrTargetReady
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const parser = isRecord(sidecar.parser) ? sidecar.parser : undefined;
  const pages = Array.isArray(sidecar.pages) ? sidecar.pages : [];
  const candidatePages = positiveIntegerArray(sidecar.ocrCandidatePages);
  const candidateLocators = stringArray(sidecar.ocrCandidateLocators);
  const expectedNativeTextReady = sidecar.textCoverage === "medium" || sidecar.textCoverage === "high";
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== pdfParserMetadataArtifactId(sourceRecord.id) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== "pdf_parse_metadata" ||
    sidecar.sourceChecksum !== sourceChecksum ||
    parser?.id !== PDF_PARSER_ID ||
    parser.engine !== PDF_PARSER_ENGINE ||
    parser.version !== PDF_PARSER_VERSION ||
    sourceRecord.metadata.parserFormat !== "pdf" ||
    sourceRecord.metadata.parserId !== PDF_PARSER_ID ||
    sourceRecord.metadata.parserEngine !== PDF_PARSER_ENGINE ||
    sourceRecord.metadata.parserVersion !== PDF_PARSER_VERSION ||
    sourceRecord.metadata.pageCount !== target.pageCount ||
    sourceRecord.metadata.processedPageCount !== target.pageCount ||
    sourceRecord.metadata.textCoverage !== sidecar.textCoverage ||
    sourceRecord.metadata.parserTruncated !== false ||
    !sameNumberArray(positiveIntegerArray(sourceRecord.metadata.ocrCandidatePages), target.pages) ||
    sidecar.pageCount !== target.pageCount ||
    sidecar.processedPageCount !== target.pageCount ||
    !isPdfTextCoverage(sidecar.textCoverage) ||
    sidecar.truncated !== false ||
    sidecar.needsOcr !== true ||
    sidecar.agentTextReady !== expectedNativeTextReady ||
    !Number.isSafeInteger(sidecar.textCharacterCount) ||
    (sidecar.textCharacterCount as number) < 0 ||
    !Number.isSafeInteger(sidecar.pagesWithText) ||
    (sidecar.pagesWithText as number) < 0 ||
    (sidecar.pagesWithText as number) > target.pageCount ||
    !sameNumberArray(candidatePages, target.pages) ||
    !sameStringArray(candidateLocators, target.pages.map((page) => `page:${page}`)) ||
    pages.length !== target.pageCount ||
    !Array.isArray(sidecar.warnings) ||
    sidecar.warnings.some((warning) => typeof warning !== "string")
  ) return false;

  const selectedByPageMetadata: number[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    const page = pages[index];
    if (
      !isRecord(page) ||
      page.page !== pageNumber ||
      page.locator !== `page:${pageNumber}` ||
      !Number.isSafeInteger(page.characterCount) ||
      (page.characterCount as number) < 0 ||
      typeof page.needsOcr !== "boolean" ||
      !Array.isArray(page.warnings) ||
      page.warnings.some((warning) => typeof warning !== "string")
    ) return false;
    if (page.needsOcr) selectedByPageMetadata.push(pageNumber);
  }
  return sameNumberArray(selectedByPageMetadata, target.pages) &&
    (target.mode === "image_only" ? sidecar.textCoverage === "none" : sidecar.textCoverage !== "none");
}

function isReusablePdfOcrSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  renderMetadataArtifact: SourceRecord["artifacts"][number],
  textArtifact: SourceRecord["artifacts"][number] | undefined,
  target: VerifiedPdfOcrTarget
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const adapter = isRecord(sidecar.adapter) ? sidecar.adapter : undefined;
  const pages = Array.isArray(sidecar.pages) ? sidecar.pages : [];
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== pdfOcrMetadataArtifactId(sourceRecord.id) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== "pdf_page_ocr_metadata" ||
    sidecar.sourceChecksum !== sourceChecksum ||
    sidecar.targetMode !== target.mode ||
    sidecar.parserMetadataArtifactId !== target.parserMetadataArtifactId ||
    sidecar.parserMetadataChecksum !== target.parserMetadataChecksum ||
    sidecar.nativeTextReady !== target.nativeTextReady ||
    sidecar.renderMetadataArtifactId !== renderMetadataArtifact.id ||
    sidecar.renderMetadataChecksum !== renderMetadataArtifact.checksum ||
    !sameNumberArray(positiveIntegerArray(sidecar.requestedPages), target.pages) ||
    adapter?.id !== "macos_vision_ocr" ||
    adapter.version !== MACOS_VISION_OCR_ADAPTER_VERSION ||
    !Number.isSafeInteger(sidecar.textCharacterCount) ||
    (sidecar.textCharacterCount as number) < 0 ||
    !Number.isSafeInteger(sidecar.blockCount) ||
    (sidecar.blockCount as number) < 0 ||
    typeof sidecar.complete !== "boolean" ||
    typeof sidecar.ocrTextReady !== "boolean" ||
    typeof sidecar.agentTextReady !== "boolean" ||
    pages.length !== target.pages.length ||
    pages.some((value, index) =>
      !isRecord(value) ||
      value.page !== target.pages[index] ||
      value.locator !== `page:${target.pages[index]}` ||
      value.renderedArtifactId !== pdfRenderedPageArtifactId(sourceRecord.id, target.pages[index] ?? 0)
    ) ||
    !Array.isArray(sidecar.units) ||
    !Array.isArray(sidecar.warnings) ||
    sidecar.warnings.some((warning) => typeof warning !== "string") ||
    sidecar.complete !== true ||
    sourceRecord.metadata.needsOcr !== false ||
    sourceRecord.metadata.agentTextReady !== sidecar.agentTextReady
  ) return false;
  if (!textArtifact) {
    return sidecar.ocrTextChecksum === undefined &&
      sidecar.textCharacterCount === 0 &&
      sidecar.ocrTextReady === false &&
      sidecar.agentTextReady === target.nativeTextReady;
  }
  return sidecar.ocrTextChecksum === textArtifact.checksum &&
    sidecar.ocrTextReady === true &&
    sidecar.agentTextReady === true;
}

function isReusablePdfRenderSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  target: VerifiedPdfOcrTarget
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const renderer = isRecord(sidecar.renderer) ? sidecar.renderer : undefined;
  const pages = Array.isArray(sidecar.pages) ? sidecar.pages : [];
  return sidecar.schemaVersion === 1 &&
    sidecar.artifactId === pdfRenderMetadataArtifactId(sourceRecord.id) &&
    sidecar.sourceId === sourceRecord.id &&
    sidecar.kind === "pdf_page_render_metadata" &&
    sidecar.sourceChecksum === sourceChecksum &&
    sidecar.targetMode === target.mode &&
    sidecar.parserMetadataArtifactId === target.parserMetadataArtifactId &&
    sidecar.parserMetadataChecksum === target.parserMetadataChecksum &&
    sidecar.nativeTextReady === target.nativeTextReady &&
    renderer?.id === PDF_PAGE_RENDERER_ID &&
    renderer.version === PDF_PAGE_RENDERER_VERSION &&
    sidecar.pageCount === target.pageCount &&
    sameNumberArray(positiveIntegerArray(sidecar.requestedPages), target.pages) &&
    sameNumberArray(positiveIntegerArray(sidecar.renderedPages), target.pages) &&
    sidecar.truncated === false &&
    pages.length === target.pages.length &&
    pages.every((value, index) => {
      const page = target.pages[index];
      return page !== undefined &&
        isRecord(value) &&
        value.page === page &&
        value.locator === `page:${page}` &&
        value.artifactId === pdfRenderedPageArtifactId(sourceRecord.id, page) &&
        typeof value.checksum === "string" &&
        isPositiveInteger(value.size) &&
        isPositiveInteger(value.width) &&
        isPositiveInteger(value.height) &&
        value.mimeType === "image/png";
    }) &&
    Array.isArray(sidecar.warnings) &&
    sidecar.warnings.every((warning) => typeof warning === "string");
}

async function renderedArtifactsMatch(
  vaultPath: string,
  sourceRecord: SourceRecord,
  pages: readonly unknown[]
): Promise<boolean> {
  for (const value of pages) {
    if (!isRecord(value) || !isPositiveInteger(value.page) || typeof value.renderedArtifactId !== "string") return false;
    const artifact = sourceRecord.artifacts.find((candidate) =>
      candidate.id === value.renderedArtifactId && candidate.kind === "rendered_page"
    );
    if (
      !artifact ||
      artifact.id !== pdfRenderedPageArtifactId(sourceRecord.id, value.page) ||
      artifact.checksum !== value.renderedChecksum ||
      !await artifactFileMatches(vaultPath, artifact)
    ) return false;
  }
  return true;
}

function upsertRenderedArtifacts(
  sourceRecord: SourceRecord,
  pages: readonly PdfStagedOcrPage[],
  metadataPath: string,
  metadataIntegrity: FileIntegrity
): SourceRecord["artifacts"] {
  const pagePrefix = `art_${sourceRecord.id.replace(/^src_/u, "")}_pdf_page_`;
  const replacedIds = new Set([pdfRenderMetadataArtifactId(sourceRecord.id)]);
  const artifacts = sourceRecord.artifacts.filter((artifact) =>
    !replacedIds.has(artifact.id) && !artifact.id.startsWith(pagePrefix)
  );
  for (const page of pages) {
    artifacts.push({
      id: page.artifactId,
      kind: "rendered_page",
      path: page.artifactPath,
      checksum: page.checksum,
      size: page.size
    });
  }
  artifacts.push({
    id: pdfRenderMetadataArtifactId(sourceRecord.id),
    kind: "metadata",
    path: metadataPath,
    ...metadataIntegrity
  });
  return artifacts;
}

function upsertPdfOcrArtifacts(
  sourceRecord: SourceRecord,
  textPath: string | undefined,
  textIntegrity: FileIntegrity | undefined,
  metadataPath: string,
  metadataIntegrity: FileIntegrity
): SourceRecord["artifacts"] {
  const replacedIds = new Set([pdfOcrTextArtifactId(sourceRecord.id), pdfOcrMetadataArtifactId(sourceRecord.id)]);
  const artifacts = sourceRecord.artifacts.filter((artifact) => !replacedIds.has(artifact.id));
  const prioritized: SourceRecord["artifacts"] = [];
  if (textPath && textIntegrity) {
    prioritized.push({ id: pdfOcrTextArtifactId(sourceRecord.id), kind: "ocr", path: textPath, ...textIntegrity });
  }
  prioritized.push({
    id: pdfOcrMetadataArtifactId(sourceRecord.id),
    kind: "metadata",
    path: metadataPath,
    ...metadataIntegrity
  });
  return [...prioritized, ...artifacts];
}

function writeRenderOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  warnings: readonly string[]
): OperationRecord {
  const pagePrefix = `art_${sourceRecord.id.replace(/^src_/u, "")}_pdf_page_`;
  const renderedPageIdentities = sourceRecord.artifacts
    .filter((artifact) => artifact.id.startsWith(pagePrefix))
    .map((artifact) => `${artifact.id}:${artifact.checksum ?? "unknown"}:${artifact.size ?? "unknown"}`)
    .sort();
  const generation = createHash("sha256").update(renderedPageIdentities.join("\n"), "utf8").digest("hex").slice(0, 10);
  return writeArtifactOperation(vaultPath, sourceRecord, job, {
    suffix: `pdf-render-artifacts-${generation}`,
    targetArtifacts: sourceRecord.artifacts.filter((artifact) =>
      artifact.id === pdfRenderMetadataArtifactId(sourceRecord.id) || artifact.id.startsWith(pagePrefix)
    ),
    sourceArtifacts: sourceRecord.artifacts.filter((artifact) =>
      artifact.id === pdfParserMetadataArtifactId(sourceRecord.id)
    ),
    summary: `Recorded bounded local PDF page artifacts for source ${sourceRecord.id}.`,
    warnings
  });
}

function writePdfOcrOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  warnings: readonly string[]
): OperationRecord {
  const targetIds = new Set([pdfOcrTextArtifactId(sourceRecord.id), pdfOcrMetadataArtifactId(sourceRecord.id)]);
  const pagePrefix = `art_${sourceRecord.id.replace(/^src_/u, "")}_pdf_page_`;
  return writeArtifactOperation(vaultPath, sourceRecord, job, {
    suffix: "pdf-ocr-artifacts",
    targetArtifacts: sourceRecord.artifacts.filter((artifact) => targetIds.has(artifact.id)),
    sourceArtifacts: sourceRecord.artifacts.filter((artifact) =>
      artifact.id === pdfParserMetadataArtifactId(sourceRecord.id) ||
      artifact.id === pdfRenderMetadataArtifactId(sourceRecord.id) ||
      artifact.id.startsWith(pagePrefix)
    ),
    summary: `Recorded local page OCR artifacts for PDF source ${sourceRecord.id}.`,
    warnings
  });
}

function writeArtifactOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  input: {
    readonly suffix: string;
    readonly targetArtifacts: readonly SourceRecord["artifacts"][number][];
    readonly sourceArtifacts: readonly SourceRecord["artifacts"][number][];
    readonly summary: string;
    readonly warnings: readonly string[];
  }
): OperationRecord {
  const operationId = createArtifactOperationId(job.id, sourceRecord.id, input.suffix);
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation ID is invalid.");
  const operationPath = [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
  const absoluteOperationPath = resolveVaultRelativePath(vaultPath, operationPath);
  if (fs.existsSync(absoluteOperationPath)) {
    const stat = fs.lstatSync(absoluteOperationPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR operation path is not a regular vault file.");
    }
    assertRealPathContainedSync(vaultPath, absoluteOperationPath);
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(absoluteOperationPath, "utf8")));
  }
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    actor: { kind: "system", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_artifact",
    targetRefs: input.targetArtifacts.map((artifact) => ({
      kind: "artifact",
      id: artifact.id,
      path: artifact.path
    })),
    sourceRefs: [
      { kind: "job", id: job.id },
      { kind: "source", id: sourceRecord.id },
      ...input.sourceArtifacts.map((artifact) => ({
        kind: "artifact" as const,
        id: artifact.id,
        path: artifact.path
      }))
    ],
    summary: input.summary,
    reversible: "best_effort",
    rollbackHint: "Remove derived PDF/OCR artifacts only after confirming the Source Record no longer references them.",
    warnings: uniqueWarnings(input.warnings)
  });
  writeJsonAtomic(absoluteOperationPath, operation, vaultPath);
  return operation;
}

function createArtifactOperationId(jobId: string, sourceId: string, suffix: string): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation has no valid date bucket.");
  const digest = createHash("sha256").update(`${jobId}:${sourceId}:${suffix}`).digest("hex").slice(0, 12);
  return `op_${dateKey}_${digest}`;
}

function pdfParserMetadataArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_metadata`;
}

function pdfParserTextArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_text`;
}

function pdfRenderedPageArtifactId(sourceId: string, page: number): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_page_${String(page).padStart(4, "0")}`;
}

function pdfRenderMetadataArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_render_metadata`;
}

function pdfOcrTextArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_ocr_text`;
}

function pdfOcrMetadataArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pdf_ocr_metadata`;
}

function sourceDateBucket(sourceId: string): [string, string] {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.source_id_invalid", "The source ID has no valid date bucket.");
  return [dateKey.slice(0, 4), dateKey.slice(4, 6)];
}

function renderWarningCodes(warnings: readonly PdfPageRendererWarning[]): string[] {
  return uniqueWarnings(warnings.map((warning) =>
    warning.page === undefined ? warning.code : `${warning.code}:page:${warning.page}`
  ));
}

function hasMatchingPngHeader(png: Uint8Array, width: number, height: number): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.byteLength < 24 || !signature.every((byte, index) => png[index] === byte)) return false;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return view.getUint32(16) === width && view.getUint32(20) === height;
}

function isSortedUniquePages(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value, index) =>
    isPositiveInteger(value) && (index === 0 || value > (values[index - 1] ?? 0))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function positiveInteger(value: unknown): number | undefined {
  return isPositiveInteger(value) ? value : undefined;
}

function positiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const pages = value.map(positiveInteger);
  if (pages.some((page) => page === undefined)) return [];
  const numbers = pages as number[];
  return numbers.every((page, index) => index === 0 || page > (numbers[index - 1] ?? 0)) ? numbers : [];
}

function isPdfTextCoverage(value: unknown): value is PdfTextCoverage {
  return value === "none" || value === "low" || value === "medium" || value === "high";
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function artifactFileMatches(vaultPath: string, artifact: SourceRecord["artifacts"][number]): Promise<boolean> {
  return Boolean(await verifyArtifactFile(vaultPath, artifact, false));
}

async function readVerifiedJsonArtifact(
  vaultPath: string,
  artifact: SourceRecord["artifacts"][number],
  maxBytes: number
): Promise<Record<string, unknown> | undefined> {
  const verified = await verifyArtifactFile(vaultPath, artifact, true, maxBytes);
  if (!verified?.bytes) return undefined;
  try {
    const value = JSON.parse(verified.bytes.toString("utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function verifyArtifactFile(
  vaultPath: string,
  artifact: SourceRecord["artifacts"][number],
  capture: boolean,
  hardSizeLimit?: number
): Promise<{ readonly bytes?: Buffer } | undefined> {
  if (!artifact.checksum || artifact.size === undefined) return undefined;
  let file: fs.promises.FileHandle | undefined;
  try {
    const filePath = resolveVaultRelativePath(vaultPath, artifact.path);
    const realVaultPath = await fs.promises.realpath(vaultPath);
    const realPath = await fs.promises.realpath(filePath);
    if (realPath !== realVaultPath && !realPath.startsWith(`${realVaultPath}${path.sep}`)) return undefined;
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    file = await fs.promises.open(filePath, flags);
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size !== artifact.size ||
      (hardSizeLimit !== undefined && before.size > hardSizeLimit)
    ) return undefined;

    const bytes = capture ? Buffer.alloc(before.size) : undefined;
    const buffer = Buffer.allocUnsafe(Math.min(Math.max(before.size, 1), 1024 * 1024));
    const hash = createHash("sha256");
    let position = 0;
    while (position < before.size) {
      const result = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (result.bytesRead === 0) return undefined;
      const chunk = buffer.subarray(0, result.bytesRead);
      hash.update(chunk);
      if (bytes) chunk.copy(bytes, position);
      position += result.bytesRead;
    }
    const after = await file.stat();
    const realPathAfter = await fs.promises.realpath(filePath);
    if (
      position !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      realPathAfter !== realPath ||
      `sha256:${hash.digest("hex")}` !== artifact.checksum
    ) return undefined;
    return bytes ? { bytes } : {};
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function fileIntegrity(filePath: string, errorCode: string): Promise<FileIntegrity> {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PigeDomainError(errorCode, "A PDF OCR artifact was not written as a regular file.");
  }
  return { checksum: await checksumFile(filePath), size: stat.size };
}

async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readCurrentSourceRecord(
  vaultPath: string,
  sourceRecordPath: string,
  expectedSourceId: string
): Promise<SourceRecordSnapshot> {
  const resolvedPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
  let file: fs.promises.FileHandle | undefined;
  try {
    const expectedRoot = path.join(path.resolve(vaultPath), ".pige", "source-records");
    const realVault = await fs.promises.realpath(vaultPath);
    const realRoot = await fs.promises.realpath(expectedRoot);
    const realPath = await fs.promises.realpath(resolvedPath);
    if (!isContainedPath(realRoot, realVault) || !isContainedPath(realPath, realRoot)) {
      throw new PigeDomainError("ocr.path_outside_vault", "The Source Record resolves outside the active vault.");
    }
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    file = await fs.promises.open(resolvedPath, flags);
    const before = await file.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_SOURCE_RECORD_BYTES) {
      throw new PigeDomainError("ocr.pdf.source_record_invalid", "The current PDF Source Record is not a bounded regular file.");
    }
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < before.size) {
      const result = await file.read(bytes, position, before.size - position, position);
      if (result.bytesRead === 0) {
        throw new PigeDomainError("ocr.pdf.target_changed", "The PDF Source Record changed while OCR was reading it.");
      }
      position += result.bytesRead;
    }
    const after = await file.stat();
    const realPathAfter = await fs.promises.realpath(resolvedPath);
    if (
      position !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      realPathAfter !== realPath
    ) {
      throw new PigeDomainError("ocr.pdf.target_changed", "The PDF Source Record changed while OCR was reading it.");
    }
    let parsed: SourceRecord;
    try {
      parsed = SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    } catch {
      throw new PigeDomainError("ocr.pdf.source_record_invalid", "The current PDF Source Record failed schema validation.");
    }
    if (parsed.id !== expectedSourceId || parsed.kind !== "pdf_file") {
      throw new PigeDomainError("ocr.pdf.source_record_invalid", "The current Source Record does not identify the expected PDF source.");
    }
    return {
      sourceRecord: parsed,
      fileChecksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("ocr.source_record_unavailable", "The current PDF Source Record is unavailable.");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function writeSourceRecordAtomic(
  vaultPath: string,
  sourceRecordPath: string,
  sourceRecord: SourceRecord,
  expectedFileChecksum: string
): void {
  const resolvedPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
  assertSafeWriteParentSync(vaultPath, resolvedPath);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(resolvedPath, flags);
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(resolvedPath);
    if (
      !descriptorStat.isFile() ||
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino ||
      descriptorStat.size <= 0 ||
      descriptorStat.size > MAX_SOURCE_RECORD_BYTES
    ) throw new PigeDomainError("ocr.source_record_unavailable", "The Source Record file is unavailable.");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < descriptorStat.size) {
      const bytesRead = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, descriptorStat.size - position),
        position
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (
      position !== descriptorStat.size ||
      `sha256:${hash.digest("hex")}` !== expectedFileChecksum
    ) {
      throw new PigeDomainError("ocr.pdf.target_changed", "The PDF Source Record changed before OCR could commit its result.");
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("ocr.source_record_unavailable", "The Source Record file is unavailable.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  writeJsonAtomic(resolvedPath, sourceRecord, vaultPath);
}

function resolveSourceRecordPath(vaultPath: string, sourceRecordPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const expectedRoot = path.join(resolvedVault, ".pige", "source-records");
  const resolvedPath = path.isAbsolute(sourceRecordPath)
    ? path.resolve(sourceRecordPath)
    : resolveVaultRelativePath(vaultPath, sourceRecordPath);
  if (!resolvedPath.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The Source Record path escapes the active vault.");
  }
  return resolvedPath;
}

function resolveVaultRelativePath(vaultPath: string, relativePath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedPath = path.resolve(vaultPath, ...relativePath.split("/"));
  if (resolvedPath !== resolvedVault && !resolvedPath.startsWith(`${resolvedVault}${path.sep}`)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR path escapes the active vault.");
  }
  return resolvedPath;
}

function writeJsonAtomic(filePath: string, value: unknown, vaultPath: string): void {
  assertSafeWriteParentSync(vaultPath, filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    assertRealPathContainedSync(vaultPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

async function writeJsonAtomicAsync(filePath: string, value: unknown, vaultPath: string): Promise<void> {
  await writeTextAtomicAsync(filePath, `${JSON.stringify(value, null, 2)}\n`, vaultPath);
}

async function writeTextAtomicAsync(filePath: string, value: string, vaultPath: string): Promise<void> {
  await assertSafeWriteParent(vaultPath, filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.promises.rename(temporaryPath, filePath);
    await assertRealPathContained(vaultPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

async function writeBinaryAtomicAsync(filePath: string, value: Uint8Array, vaultPath: string): Promise<void> {
  await assertSafeWriteParent(vaultPath, filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, value, { flag: "wx", mode: 0o600 });
    await fs.promises.rename(temporaryPath, filePath);
    await assertRealPathContained(vaultPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
}

async function assertSafeWriteParent(vaultPath: string, filePath: string): Promise<void> {
  assertLexicalPathContained(vaultPath, filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const realVault = await fs.promises.realpath(vaultPath);
  const realParent = await fs.promises.realpath(path.dirname(filePath));
  if (!isContainedPath(realParent, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write parent resolves outside the active vault.");
  }
  const existing = await fs.promises.lstat(filePath).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write target is not a regular vault file.");
  }
}

function assertSafeWriteParentSync(vaultPath: string, filePath: string): void {
  assertLexicalPathContained(vaultPath, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const realVault = fs.realpathSync(vaultPath);
  const realParent = fs.realpathSync(path.dirname(filePath));
  if (!isContainedPath(realParent, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write parent resolves outside the active vault.");
  }
  try {
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write target is not a regular vault file.");
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}

async function assertRealPathContained(vaultPath: string, filePath: string): Promise<void> {
  const [realVault, realFile] = await Promise.all([
    fs.promises.realpath(vaultPath),
    fs.promises.realpath(filePath)
  ]);
  if (!isContainedPath(realFile, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write escaped the active vault.");
  }
}

function assertRealPathContainedSync(vaultPath: string, filePath: string): void {
  if (!isContainedPath(fs.realpathSync(filePath), fs.realpathSync(vaultPath))) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write escaped the active vault.");
  }
}

function assertLexicalPathContained(vaultPath: string, filePath: string): void {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  if (!isContainedPath(resolvedFile, resolvedVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PDF OCR write path escapes the active vault.");
  }
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sourcePageConflictWarning(): string {
  return "The source page was edited after capture, so Pige preserved the edit and did not replace its body.";
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function normalizedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 64);
}

function uniqueWarnings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
