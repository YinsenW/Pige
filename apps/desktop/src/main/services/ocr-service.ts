import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type JobRecord, type SourceKind, type SourceRecord } from "@pige/schemas";
import { MacOSVisionOcrAdapter } from "./macos-vision-ocr-adapter";
import { OcrArtifactService, type OcrSourceResult } from "./ocr-artifact-service";
import {
  OfficeMediaMaterializerWorkerAdapter,
  type OfficeMediaMaterializerPort
} from "./office-media-materializer-service";
import {
  OFFICE_MEDIA_MATERIALIZER_ID,
  OFFICE_MEDIA_MATERIALIZER_VERSION,
  type MaterializedOfficeMedia,
  type OfficeMediaTarget
} from "./office-parser-types";
import {
  PdfOcrArtifactService,
  inspectPdfOcrTarget,
  type PdfPageOcrResult,
  type PdfRenderForOcrInput
} from "./pdf-ocr-artifact-service";
import { PdfPageRendererService, type PdfPageRendererPort } from "./pdf-page-renderer-service";
import {
  OfficeMediaOcrArtifactService,
  inspectOfficeMediaOcrTarget,
  type PptxMediaOcrItemResult
} from "./pptx-media-ocr-artifact-service";
import {
  PptxSlideOcrArtifactAdapter,
  inspectPptxSlideOcrTarget,
  type PptxSlideOcrItemResult
} from "./pptx-slide-ocr-artifact-adapter";
import { createVerifiedSourceFileSnapshotAsync, verifyReadableSourceFileAsync } from "./source-file-access";
import { createVerifiedFileSnapshot } from "./verified-file-snapshot";
import { JobCancellationError, type JobExecutionControl } from "./job-execution-control";
import { resolveOcrJobLanguageHints } from "./ocr-language-preference-service";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION
} from "./office-parser-types";
import {
  PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS,
  PPTX_SLIDE_MATERIALIZER_ID,
  PPTX_SLIDE_MATERIALIZER_MAX_EDGE,
  PPTX_SLIDE_MATERIALIZER_MAX_PIXELS,
  PPTX_SLIDE_MATERIALIZER_MAX_PNG_BYTES_PER_SLIDE,
  PPTX_SLIDE_MATERIALIZER_MAX_TOTAL_PNG_BYTES,
  PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION,
  PPTX_SLIDE_MATERIALIZER_VERSION,
  PptxSlideMaterializerService,
  type PptxSlideMaterializerPort
} from "./pptx-slide-materializer-core";

export interface OcrPort {
  canOcr(sourceKind: SourceKind): boolean;
  inspectSource?(sourceRecord: SourceRecord): OcrSourceCapability;
  ocrSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult>;
}

export interface OcrSourceCapability {
  readonly ready: boolean;
  readonly message: string;
}

export interface NativeImageOcrAdapterPort {
  isAvailable(): boolean;
  recognize(
    inputPath: string,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): ReturnType<MacOSVisionOcrAdapter["recognize"]>;
  recognizeBytes?(
    bytes: Uint8Array,
    preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): ReturnType<MacOSVisionOcrAdapter["recognize"]>;
}

export class OcrService implements OcrPort {
  readonly #adapter: NativeImageOcrAdapterPort;
  readonly #artifacts: OcrArtifactService;
  readonly #pdfRenderer: PdfPageRendererPort;
  readonly #pdfArtifacts: PdfOcrArtifactService;
  readonly #officeMedia: OfficeMediaMaterializerPort;
  readonly #officeArtifacts: OfficeMediaOcrArtifactService;
  readonly #pptxSlideArtifacts: PptxSlideOcrArtifactAdapter;
  readonly #pptxSlides: PptxSlideMaterializerPort;

  constructor(
    adapter: NativeImageOcrAdapterPort = new MacOSVisionOcrAdapter(),
    artifacts = new OcrArtifactService(),
    pdfRenderer: PdfPageRendererPort = new PdfPageRendererService(),
    pdfArtifacts = new PdfOcrArtifactService(),
    officeMedia: OfficeMediaMaterializerPort = new OfficeMediaMaterializerWorkerAdapter(),
    officeArtifacts = new OfficeMediaOcrArtifactService(),
    pptxSlides: PptxSlideMaterializerPort = new PptxSlideMaterializerService(),
    pptxSlideArtifacts: PptxSlideOcrArtifactAdapter = new PptxSlideOcrArtifactAdapter()
  ) {
    this.#adapter = adapter;
    this.#artifacts = artifacts;
    this.#pdfRenderer = pdfRenderer;
    this.#pdfArtifacts = pdfArtifacts;
    this.#officeMedia = officeMedia;
    this.#officeArtifacts = officeArtifacts;
    this.#pptxSlideArtifacts = pptxSlideArtifacts;
    this.#pptxSlides = pptxSlides;
  }

  canOcr(sourceKind: SourceKind): boolean {
    if (sourceKind === "image_file") return this.#adapter.isAvailable();
    if (sourceKind === "pdf_file") return this.#adapter.isAvailable() && this.#pdfRenderer.isAvailable();
    if (sourceKind === "pptx_file") {
      return this.#pptxSlides.isAvailable() && this.#adapter.isAvailable() && hasRecognizeBytes(this.#adapter);
    }
    return sourceKind === "docx_file" && this.#adapter.isAvailable() && this.#officeMedia.isAvailable();
  }

  inspectSource(sourceRecord: SourceRecord): OcrSourceCapability {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind === "image_file") {
      if (hasOcrMetadataArtifact(parsedSource, "_ocr_metadata")) {
        return { ready: true, message: "Existing image OCR output is ready for integrity verification and reuse." };
      }
      return this.#adapter.isAvailable()
        ? { ready: true, message: "Image source preserved; local OCR job queued." }
        : {
            ready: false,
            message: "Image source preserved; waiting for local OCR capability from a healthy platform helper."
          };
    }
    if (parsedSource.kind === "pdf_file") {
      const target = inspectPdfOcrTarget(parsedSource);
      if (!target.ready) return target;
      if (hasOcrMetadataArtifact(parsedSource, "_pdf_ocr_metadata")) {
        return { ready: true, message: "Existing PDF OCR output is ready for integrity verification and reuse." };
      }
      if (!this.#pdfRenderer.isAvailable()) {
        return {
          ready: false,
          message: "PDF OCR target selected; waiting for the bundled local PDF page renderer."
        };
      }
      if (!this.#adapter.isAvailable()) {
        return {
          ready: false,
          message: "PDF OCR target selected; waiting for local OCR capability from a healthy platform helper."
        };
      }
      return {
        ready: true,
        message: target.mode === "image_only"
          ? `Image-only PDF parsed; local OCR queued for ${target.pages.length} page${target.pages.length === 1 ? "" : "s"}.`
          : `Mixed-text PDF parsed; local OCR enrichment queued for ${target.pages.length} sparse page${target.pages.length === 1 ? "" : "s"}.`
      };
    }
    if (parsedSource.kind === "docx_file" || parsedSource.kind === "pptx_file") {
      if (parsedSource.kind === "pptx_file") {
        const target = inspectPptxSlideOcrTarget(parsedSource);
        if (!target.ready) return target;
        if (hasOcrMetadataArtifact(parsedSource, "_pptx_slide_ocr_metadata")) {
          return { ready: true, message: "Existing PPTX full-slide OCR output is ready for integrity verification and reuse." };
        }
        if (!this.#pptxSlides.isAvailable()) {
          return { ready: false, message: "PPTX slide OCR is waiting for the bundled local Canvas materializer capability." };
        }
        if (!this.#adapter.isAvailable() || !hasRecognizeBytes(this.#adapter)) {
          return { ready: false, message: "PPTX slides are selected; waiting for local OCR capability that accepts in-memory rendered pixels." };
        }
        return { ready: true, message: target.message };
      }
      const format = parsedSource.kind === "docx_file" ? "DOCX" : "PPTX";
      const suffix = parsedSource.kind === "docx_file" ? "_docx_media_ocr_metadata" : "_pptx_media_ocr_metadata";
      const target = inspectOfficeMediaOcrTarget(parsedSource);
      if (!target.ready) return target;
      if (hasOcrMetadataArtifact(parsedSource, suffix)) {
        return { ready: true, message: `Existing ${format} media OCR output is ready for integrity verification and reuse.` };
      }
      if (!this.#officeMedia.isAvailable()) {
        return { ready: false, message: `${format} media OCR is waiting for the bundled bounded Office media materializer.` };
      }
      if (!this.#adapter.isAvailable()) {
        return {
          ready: false,
          message: `${format} media targets are selected; waiting for local OCR capability from a healthy platform helper.`
        };
      }
      return { ready: true, message: target.message };
    }
    return {
      ready: false,
      message: "This document is waiting for a reviewed slide or media pixel materializer before local OCR can run."
    };
  }

  async ocrSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind === "image_file") {
      return this.#ocrImage(vaultPath, parsedSource, sourceRecordPath, job, control);
    }
    if (parsedSource.kind === "pdf_file") {
      return this.#ocrPdf(vaultPath, parsedSource, sourceRecordPath, job, control);
    }
    if (parsedSource.kind === "docx_file" || parsedSource.kind === "pptx_file") {
      if (parsedSource.kind === "pptx_file") {
        return this.#ocrPptxSlides(vaultPath, parsedSource, sourceRecordPath, job, control);
      }
      return this.#ocrOfficeMedia(vaultPath, parsedSource, sourceRecordPath, job, control);
    }
    throw new PigeDomainError("ocr.source_unsupported", "No local OCR path supports this source kind.");
  }

  async #ocrImage(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult> {
    control?.throwIfCancellationRequested();
    control?.reportProgress({ completedUnits: 0, totalUnits: 1, unit: "image" });
    const existing = await this.#artifacts.readExisting(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      () => control?.markDurableCheckpoint("image_ocr_existing_publication_started")
    );
    if (existing) return existing;
    if (!this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", "No available local OCR adapter supports this source.");
    }
    const snapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    try {
      const result = await this.#adapter.recognize(
        snapshot.absolutePath,
        resolveOcrJobLanguageHints(job),
        control?.signal
      );
      control?.throwIfCancellationRequested();
      control?.markDurableCheckpoint("image_ocr_commit_started");
      return this.#artifacts.persist(vaultPath, sourceRecord, sourceRecordPath, job, result);
    } finally {
      await snapshot.dispose();
    }
  }

  async #ocrPdf(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult> {
    control?.throwIfCancellationRequested();
    const inspection = inspectPdfOcrTarget(sourceRecord);
    if (inspection.ready) {
      control?.reportProgress({ completedUnits: 0, totalUnits: inspection.pages.length, unit: "page" });
    }
    const existing = await this.#pdfArtifacts.readExisting(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      () => control?.markDurableCheckpoint("pdf_ocr_existing_publication_started")
    );
    if (existing) return existing;
    if (!this.#pdfRenderer.isAvailable() || !this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", this.inspectSource(sourceRecord).message);
    }
    const target = await this.#pdfArtifacts.resolveTarget(vaultPath, sourceRecord);
    if (!inspection.ready) {
      control?.reportProgress({ completedUnits: 0, totalUnits: target.pages.length, unit: "page" });
    }
    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    let rendered: Awaited<ReturnType<PdfPageRendererPort["renderPages"]>>;
    try {
      rendered = await this.#pdfRenderer.renderPages(sourceSnapshot.absolutePath, target.pages, control?.signal);
    } finally {
      await sourceSnapshot.dispose();
    }
    control?.throwIfCancellationRequested();
    const renderInput: PdfRenderForOcrInput = {
      rendererId: rendered.rendererId,
      rendererVersion: rendered.rendererVersion,
      pageCount: rendered.pageCount,
      requestedPages: rendered.requestedPages,
      pages: rendered.pages.map((page) => ({
        page: page.renderedPage,
        locator: page.locator,
        png: page.png,
        width: page.width,
        height: page.height
      })),
      warnings: rendered.warnings,
      truncated: rendered.truncated
    };
    control?.markDurableCheckpoint("pdf_pages_staging_started");
    const staging = await this.#pdfArtifacts.stageRenderedPages(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      renderInput
    );
    control?.throwIfCancellationRequested();
    if (rendered.truncated || rendered.pages.length !== target.pages.length) {
      throw new PigeDomainError(
        "ocr.pdf.render_incomplete",
        "PDF page rendering was incomplete; validated page artifacts were preserved for retry."
      );
    }
    const pageResults: PdfPageOcrResult[] = [];
    for (const page of staging.pages) {
      control?.throwIfCancellationRequested();
      const pageSnapshot = await createVerifiedFileSnapshot({
        sourcePath: page.absolutePath,
        expectedChecksum: page.checksum,
        expectedSize: page.size,
        unavailableCode: "ocr.pdf.rendered_page_changed",
        integrityCode: "ocr.pdf.rendered_page_changed",
        containmentRoot: vaultPath
      });
      try {
        pageResults.push({
          page: page.page,
          locator: page.locator,
          result: await this.#adapter.recognize(
            pageSnapshot.absolutePath,
            resolveOcrJobLanguageHints(job),
            control?.signal
          )
        });
      } catch (caught) {
        if (caught instanceof JobCancellationError) throw caught;
        if (control?.signal.aborted) control.throwIfCancellationRequested();
        if (isUnavailableOcrError(caught)) throw caught;
        if (isDeterministicMediaOcrError(caught)) throw caught;
        throw new PigeDomainError(
          "ocr.pdf.page_failed",
          "Local OCR failed for a rendered PDF page; validated page artifacts remain retryable."
        );
      } finally {
        await pageSnapshot.dispose();
      }
      control?.reportProgress({
        completedUnits: pageResults.length,
        totalUnits: staging.pages.length,
        unit: "page"
      });
    }
    control?.throwIfCancellationRequested();
    return this.#pdfArtifacts.persistOcr(vaultPath, staging, sourceRecordPath, job, pageResults);
  }

  async #ocrPptxSlides(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult> {
    control?.throwIfCancellationRequested();
    const inspection = inspectPptxSlideOcrTarget(sourceRecord);
    if (inspection.ready) {
      control?.reportProgress({
        completedUnits: 0,
        totalUnits: inspection.materializableSlideCount,
        unit: "media"
      });
    }
    const existing = await this.#pptxSlideArtifacts.readExistingPptxSlides(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      () => control?.markDurableCheckpoint("pptx_slide_ocr_existing_publication_started")
    );
    if (existing) return existing;
    if (!this.#pptxSlides.isAvailable() || !this.#adapter.isAvailable() || !hasRecognizeBytes(this.#adapter)) {
      throw new PigeDomainError("ocr.pptx.slide_capability_unavailable", this.inspectSource(sourceRecord).message);
    }
    const target = await this.#pptxSlideArtifacts.resolvePptxSlideTarget(vaultPath, sourceRecord);
    if (!inspection.ready) {
      control?.reportProgress({ completedUnits: 0, totalUnits: target.slideLocators.length, unit: "media" });
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, sourceRecord);
    const request = {
      protocolVersion: PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION,
      requestId: `ocr_${job.id}_pptx_slide`,
      filePath: sourceFile.absolutePath,
      sourceChecksum: sourceFile.checksum,
      parser: {
        artifactId: target.parserMetadataArtifactId,
        checksum: target.parserMetadataChecksum,
        sourceChecksum: sourceFile.checksum,
        parserId: OFFICE_PARSER_ID,
        parserEngine: OFFICE_PARSER_ENGINE,
        parserVersion: OFFICE_PARSER_VERSION,
        slideLocators: target.slideLocators
      },
      slideLocators: target.slideLocators,
      limits: PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS
    } as const;
    control?.markDurableCheckpoint("pptx_slide_ocr_materializer_started");
    let materialized: Awaited<ReturnType<PptxSlideMaterializerPort["materialize"]>>;
    try {
      materialized = await this.#pptxSlides.materialize(request);
    } catch (caught) {
      if (caught instanceof JobCancellationError) throw caught;
      if (control?.signal.aborted) control.throwIfCancellationRequested();
      if (isUnavailableOcrError(caught)) throw caught;
      if (isDeterministicMediaOcrError(caught) || isDeterministicPptxMaterializerError(caught)) throw caught;
      throw new PigeDomainError(
        "ocr.pptx.slide_materializer_failed",
        "The bounded PPTX slide materializer failed; the preserved parser artifacts remain retryable."
      );
    }
    control?.throwIfCancellationRequested();
    const slides = validateMaterializedSlides(
      target.slideLocators,
      materialized,
      sourceFile.checksum,
      target.parserMetadataChecksum
    );
    const results: PptxSlideOcrItemResult[] = [];
    for (const slide of slides) {
      control?.throwIfCancellationRequested();
      try {
        const result = await recognizePrivateBytes(
          this.#adapter,
          slide.png,
          resolveOcrJobLanguageHints(job),
          control?.signal
        );
        results.push({
          slide: slide.slide,
          locator: slide.locator,
          renderChecksum: checksumBytes(slide.png),
          renderSize: slide.png.byteLength,
          width: slide.width,
          height: slide.height,
          result
        });
      } catch (caught) {
        if (caught instanceof JobCancellationError) throw caught;
        if (control?.signal.aborted) control.throwIfCancellationRequested();
        if (isUnavailableOcrError(caught)) throw caught;
        if (isDeterministicMediaOcrError(caught)) throw caught;
        throw new PigeDomainError(
          "ocr.pptx.slide_failed",
          "Local OCR failed for a rendered PPTX slide; validated parser provenance remains retryable."
        );
      }
      control?.reportProgress({
        completedUnits: results.length,
        totalUnits: slides.length,
        unit: "media"
      });
    }
    control?.throwIfCancellationRequested();
    control?.markDurableCheckpoint("pptx_slide_ocr_commit_started");
    return this.#pptxSlideArtifacts.persistPptxSlides(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      results,
      {
        materializerId: materialized.materializerId,
        materializerVersion: materialized.materializerVersion,
        parserMetadataChecksum: materialized.parserMetadataChecksum,
        warnings: materialized.warnings,
        renderIncomplete: materialized.renderIncomplete
      }
    );
  }

  async #ocrOfficeMedia(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<OcrSourceResult> {
    control?.throwIfCancellationRequested();
    const format = sourceRecord.kind === "docx_file" ? "docx" : "pptx";
    const inspection = inspectOfficeMediaOcrTarget(sourceRecord);
    if (inspection.ready) {
      control?.reportProgress({
        completedUnits: 0,
        totalUnits: inspection.materializableMediaCount,
        unit: "media"
      });
    }
    const existing = await this.#officeArtifacts.readExisting(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      () => control?.markDurableCheckpoint(`${format}_media_ocr_existing_publication_started`)
    );
    if (existing) return existing;
    if (!this.#officeMedia.isAvailable() || !this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", this.inspectSource(sourceRecord).message);
    }
    const target = await this.#officeArtifacts.resolveTarget(vaultPath, sourceRecord);
    if (!inspection.ready) {
      control?.reportProgress({ completedUnits: 0, totalUnits: target.targets.length, unit: "media" });
    }
    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    let materialized: Awaited<ReturnType<OfficeMediaMaterializerPort["materialize"]>>;
    try {
      materialized = await this.#officeMedia.materialize(
        sourceSnapshot.absolutePath,
        target.targets,
        control?.signal,
        format === "docx" ? "docx_file" : "pptx_file"
      );
    } finally {
      await sourceSnapshot.dispose();
    }
    control?.throwIfCancellationRequested();
    const media = validateMaterializedMedia(target.targets, materialized, format);
    const results: PptxMediaOcrItemResult[] = [];
    for (const item of media) {
      control?.throwIfCancellationRequested();
      try {
        const result = await recognizePrivateMedia(
          this.#adapter,
          item,
          resolveOcrJobLanguageHints(job),
          control?.signal
        );
        results.push({
          target: item,
          mediaChecksum: checksumBytes(item.bytes),
          mediaSize: item.bytes.byteLength,
          result
        });
      } catch (caught) {
        if (caught instanceof JobCancellationError) throw caught;
        if (control?.signal.aborted) control.throwIfCancellationRequested();
        if (isUnavailableOcrError(caught)) throw caught;
        if (isDeterministicMediaOcrError(caught)) throw caught;
        throw new PigeDomainError(
          `ocr.${format}.media_failed`,
          `Local OCR failed for selected ${format.toUpperCase()} media; preserved parser artifacts remain retryable.`
        );
      }
      control?.reportProgress({
        completedUnits: results.length,
        totalUnits: media.length,
        unit: "media"
      });
    }
    control?.throwIfCancellationRequested();
    control?.markDurableCheckpoint(`${format}_media_ocr_commit_started`);
    return this.#officeArtifacts.persist(vaultPath, sourceRecord, sourceRecordPath, job, results);
  }
}

function hasOcrMetadataArtifact(sourceRecord: SourceRecord, suffix: string): boolean {
  return sourceRecord.artifacts.some((artifact) => artifact.kind === "metadata" && artifact.id.endsWith(suffix));
}

function hasRecognizeBytes(adapter: NativeImageOcrAdapterPort): boolean {
  return typeof adapter.recognizeBytes === "function";
}

function isUnavailableOcrError(caught: unknown): boolean {
  return caught instanceof PigeDomainError &&
    /^(?:ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)|ocr\.pptx\.(?:slide_capability_unavailable|bytes_adapter_unavailable)|source\.external_unavailable)$/u.test(caught.code);
}

function isDeterministicMediaOcrError(caught: unknown): boolean {
  return caught instanceof PigeDomainError &&
    /^ocr\.image\.(?:source_missing|not_regular|file_too_large|invalid|unsupported_format|multiframe_unsupported|dimensions_invalid|dimensions_too_large|decode_failed)$/u.test(caught.code);
}

function isDeterministicPptxMaterializerError(caught: unknown): boolean {
  return caught instanceof PigeDomainError && /^parser\.pptx\./u.test(caught.code);
}

async function recognizePrivateBytes(
  adapter: NativeImageOcrAdapterPort,
  bytes: Uint8Array,
  languages: readonly string[],
  signal?: AbortSignal
): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
  if (!adapter.recognizeBytes) {
    throw new PigeDomainError("ocr.pptx.bytes_adapter_unavailable", "The selected local OCR adapter does not accept in-memory rendered slide pixels.");
  }
  return adapter.recognizeBytes(bytes, languages, signal);
}

function validateMaterializedSlides(
  requestedLocators: readonly string[],
  result: Awaited<ReturnType<PptxSlideMaterializerPort["materialize"]>>,
  sourceChecksum: string,
  parserMetadataChecksum: string
) {
  const requestedSlides = requestedLocators.map((locator) => Number(/^slide:(\d+)$/u.exec(locator)?.[1]));
  if (
    result.protocolVersion !== PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION ||
    result.materializerId !== PPTX_SLIDE_MATERIALIZER_ID ||
    result.materializerVersion !== PPTX_SLIDE_MATERIALIZER_VERSION ||
    result.sourceChecksum !== sourceChecksum ||
    result.parserMetadataChecksum !== parserMetadataChecksum ||
    result.requestedSlides.length !== requestedSlides.length ||
    result.requestedSlides.some((slide, index) => slide !== requestedSlides[index]) ||
    result.renderedSlides.length !== requestedSlides.length ||
    result.renderedSlides.some((slide, index) => slide !== requestedSlides[index]) ||
    result.slides.length !== requestedLocators.length
  ) {
    throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "The PPTX slide materializer returned an invalid selected slide set.");
  }
  let totalBytes = 0;
  for (let index = 0; index < requestedLocators.length; index += 1) {
    const locator = requestedLocators[index];
    const slide = result.slides[index];
    const expectedSlide = requestedSlides[index];
    if (
      !locator ||
      !slide ||
      slide.slide !== expectedSlide ||
      slide.locator !== `${locator}/render` ||
      slide.mimeType !== "image/png" ||
      !(slide.png instanceof Uint8Array) ||
      slide.png.byteLength !== slide.pngByteSize ||
      slide.png.byteLength <= 0 ||
      slide.png.byteLength > PPTX_SLIDE_MATERIALIZER_MAX_PNG_BYTES_PER_SLIDE ||
      !Number.isSafeInteger(slide.width) ||
      !Number.isSafeInteger(slide.height) ||
      slide.width <= 0 ||
      slide.height <= 0 ||
      slide.width > PPTX_SLIDE_MATERIALIZER_MAX_EDGE ||
      slide.height > PPTX_SLIDE_MATERIALIZER_MAX_EDGE ||
      slide.width * slide.height > PPTX_SLIDE_MATERIALIZER_MAX_PIXELS
    ) {
      throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "A PPTX rendered slide failed the frozen pixel and PNG bounds.");
    }
    totalBytes += slide.png.byteLength;
  }
  if (totalBytes !== result.totalPngByteSize || totalBytes > PPTX_SLIDE_MATERIALIZER_MAX_TOTAL_PNG_BYTES) {
    throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "The PPTX rendered slide aggregate exceeded the frozen PNG bound.");
  }
  return result.slides;
}

function validateMaterializedMedia(
  targets: readonly OfficeMediaTarget[],
  result: Awaited<ReturnType<OfficeMediaMaterializerPort["materialize"]>>,
  format: "docx" | "pptx"
): readonly MaterializedOfficeMedia[] {
  if (
    result.materializerId !== OFFICE_MEDIA_MATERIALIZER_ID ||
    result.materializerVersion !== OFFICE_MEDIA_MATERIALIZER_VERSION ||
    result.media.length !== targets.length
  ) {
    throw new PigeDomainError(`ocr.${format}.materializer_result_invalid`, `The ${format.toUpperCase()} media materializer returned an invalid target set.`);
  }
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const item = result.media[index];
    if (
      !target ||
      !item ||
      !sameMediaTarget(item, target) ||
      !(item.bytes instanceof Uint8Array) ||
      item.bytes.byteLength !== target.size
    ) {
      throw new PigeDomainError(`ocr.${format}.materializer_result_invalid`, `A materialized ${format.toUpperCase()} media item is invalid.`);
    }
  }
  return result.media;
}

async function recognizePrivateMedia(
  adapter: NativeImageOcrAdapterPort,
  media: MaterializedOfficeMedia,
  languages: readonly string[],
  signal?: AbortSignal
): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pige-office-media-"));
  const filePath = path.join(root, `media${media.extension}`);
  try {
    await fs.promises.chmod(root, 0o700).catch(() => undefined);
    await fs.promises.writeFile(filePath, media.bytes, { flag: "wx", mode: 0o600 });
    return await adapter.recognize(filePath, languages, signal);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

function checksumBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameMediaTarget(left: OfficeMediaTarget, right: OfficeMediaTarget): boolean {
  return left.slide === right.slide &&
    left.image === right.image &&
    left.parentLocator === right.parentLocator &&
    left.mediaIndex === right.mediaIndex &&
    left.locator === right.locator &&
    left.packagePath === right.packagePath &&
    left.size === right.size &&
    left.extension === right.extension;
}
