import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type JobRecord, type SourceKind, type SourceRecord } from "@pige/schemas";
import { MacOSVisionOcrAdapter } from "./macos-vision-ocr-adapter";
import { OcrArtifactService, type OcrSourceResult } from "./ocr-artifact-service";
import {
  PdfOcrArtifactService,
  inspectPdfOcrTarget,
  type PdfPageOcrResult,
  type PdfRenderForOcrInput
} from "./pdf-ocr-artifact-service";
import { PdfPageRendererService, type PdfPageRendererPort } from "./pdf-page-renderer-service";
import { createVerifiedSourceFileSnapshotAsync } from "./source-file-access";
import { createVerifiedFileSnapshot } from "./verified-file-snapshot";

export interface OcrPort {
  canOcr(sourceKind: SourceKind): boolean;
  inspectSource?(sourceRecord: SourceRecord): OcrSourceCapability;
  ocrSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult>;
}

export interface OcrSourceCapability {
  readonly ready: boolean;
  readonly message: string;
}

export interface NativeImageOcrAdapterPort {
  isAvailable(): boolean;
  recognize(inputPath: string, preferredLanguages: readonly string[]): ReturnType<MacOSVisionOcrAdapter["recognize"]>;
}

export class OcrService implements OcrPort {
  readonly #adapter: NativeImageOcrAdapterPort;
  readonly #artifacts: OcrArtifactService;
  readonly #pdfRenderer: PdfPageRendererPort;
  readonly #pdfArtifacts: PdfOcrArtifactService;

  constructor(
    adapter: NativeImageOcrAdapterPort = new MacOSVisionOcrAdapter(),
    artifacts = new OcrArtifactService(),
    pdfRenderer: PdfPageRendererPort = new PdfPageRendererService(),
    pdfArtifacts = new PdfOcrArtifactService()
  ) {
    this.#adapter = adapter;
    this.#artifacts = artifacts;
    this.#pdfRenderer = pdfRenderer;
    this.#pdfArtifacts = pdfArtifacts;
  }

  canOcr(sourceKind: SourceKind): boolean {
    if (sourceKind === "image_file") return this.#adapter.isAvailable();
    return sourceKind === "pdf_file" && this.#adapter.isAvailable() && this.#pdfRenderer.isAvailable();
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
    return {
      ready: false,
      message: "This document is waiting for a reviewed slide or media pixel materializer before local OCR can run."
    };
  }

  async ocrSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind === "image_file") {
      return this.#ocrImage(vaultPath, parsedSource, sourceRecordPath, job);
    }
    if (parsedSource.kind === "pdf_file") {
      return this.#ocrPdf(vaultPath, parsedSource, sourceRecordPath, job);
    }
    throw new PigeDomainError("ocr.source_unsupported", "No local OCR path supports this source kind.");
  }

  async #ocrImage(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult> {
    const existing = await this.#artifacts.readExisting(vaultPath, sourceRecord, sourceRecordPath, job);
    if (existing) return existing;
    if (!this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", "No available local OCR adapter supports this source.");
    }
    const snapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    try {
      const result = await this.#adapter.recognize(snapshot.absolutePath, preferredLanguages(sourceRecord));
      return this.#artifacts.persist(vaultPath, sourceRecord, sourceRecordPath, job, result);
    } finally {
      await snapshot.dispose();
    }
  }

  async #ocrPdf(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult> {
    const existing = await this.#pdfArtifacts.readExisting(vaultPath, sourceRecord, sourceRecordPath, job);
    if (existing) return existing;
    if (!this.#pdfRenderer.isAvailable() || !this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", this.inspectSource(sourceRecord).message);
    }
    const target = await this.#pdfArtifacts.resolveTarget(vaultPath, sourceRecord);
    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    let rendered: Awaited<ReturnType<PdfPageRendererPort["renderPages"]>>;
    try {
      rendered = await this.#pdfRenderer.renderPages(sourceSnapshot.absolutePath, target.pages);
    } finally {
      await sourceSnapshot.dispose();
    }
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
    const staging = await this.#pdfArtifacts.stageRenderedPages(
      vaultPath,
      sourceRecord,
      sourceRecordPath,
      job,
      renderInput
    );
    if (rendered.truncated || rendered.pages.length !== target.pages.length) {
      throw new PigeDomainError(
        "ocr.pdf.render_incomplete",
        "PDF page rendering was incomplete; validated page artifacts were preserved for retry."
      );
    }
    const pageResults: PdfPageOcrResult[] = [];
    for (const page of staging.pages) {
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
          result: await this.#adapter.recognize(pageSnapshot.absolutePath, preferredLanguages(sourceRecord))
        });
      } catch (caught) {
        if (isUnavailableOcrError(caught)) throw caught;
        throw new PigeDomainError(
          "ocr.pdf.page_failed",
          "Local OCR failed for a rendered PDF page; validated page artifacts remain retryable."
        );
      } finally {
        await pageSnapshot.dispose();
      }
    }
    return this.#pdfArtifacts.persistOcr(vaultPath, staging, sourceRecordPath, job, pageResults);
  }
}

function preferredLanguages(sourceRecord: SourceRecord): readonly string[] {
  return typeof sourceRecord.metadata.locale === "string" ? [sourceRecord.metadata.locale] : [];
}

function hasOcrMetadataArtifact(sourceRecord: SourceRecord, suffix: string): boolean {
  return sourceRecord.artifacts.some((artifact) => artifact.kind === "metadata" && artifact.id.endsWith(suffix));
}

function isUnavailableOcrError(caught: unknown): boolean {
  return caught instanceof PigeDomainError &&
    /^(?:ocr\.(?:adapter_unavailable|helper_unavailable|platform_unsupported)|source\.external_unavailable)$/u.test(caught.code);
}
