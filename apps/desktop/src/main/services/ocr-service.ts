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
  PptxMediaOcrArtifactService,
  inspectPptxMediaOcrTarget,
  type PptxMediaOcrItemResult
} from "./pptx-media-ocr-artifact-service";
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
  readonly #officeMedia: OfficeMediaMaterializerPort;
  readonly #pptxArtifacts: PptxMediaOcrArtifactService;

  constructor(
    adapter: NativeImageOcrAdapterPort = new MacOSVisionOcrAdapter(),
    artifacts = new OcrArtifactService(),
    pdfRenderer: PdfPageRendererPort = new PdfPageRendererService(),
    pdfArtifacts = new PdfOcrArtifactService(),
    officeMedia: OfficeMediaMaterializerPort = new OfficeMediaMaterializerWorkerAdapter(),
    pptxArtifacts = new PptxMediaOcrArtifactService()
  ) {
    this.#adapter = adapter;
    this.#artifacts = artifacts;
    this.#pdfRenderer = pdfRenderer;
    this.#pdfArtifacts = pdfArtifacts;
    this.#officeMedia = officeMedia;
    this.#pptxArtifacts = pptxArtifacts;
  }

  canOcr(sourceKind: SourceKind): boolean {
    if (sourceKind === "image_file") return this.#adapter.isAvailable();
    if (sourceKind === "pdf_file") return this.#adapter.isAvailable() && this.#pdfRenderer.isAvailable();
    return sourceKind === "pptx_file" && this.#adapter.isAvailable() && this.#officeMedia.isAvailable();
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
    if (parsedSource.kind === "pptx_file") {
      const target = inspectPptxMediaOcrTarget(parsedSource);
      if (!target.ready) return target;
      if (hasOcrMetadataArtifact(parsedSource, "_pptx_media_ocr_metadata")) {
        return { ready: true, message: "Existing PPTX media OCR output is ready for integrity verification and reuse." };
      }
      if (!this.#officeMedia.isAvailable()) {
        return { ready: false, message: "PPTX media OCR is waiting for the bundled bounded Office media materializer." };
      }
      if (!this.#adapter.isAvailable()) {
        return {
          ready: false,
          message: "PPTX media targets are selected; waiting for local OCR capability from a healthy platform helper."
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
    job: JobRecord
  ): Promise<OcrSourceResult> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind === "image_file") {
      return this.#ocrImage(vaultPath, parsedSource, sourceRecordPath, job);
    }
    if (parsedSource.kind === "pdf_file") {
      return this.#ocrPdf(vaultPath, parsedSource, sourceRecordPath, job);
    }
    if (parsedSource.kind === "pptx_file") {
      return this.#ocrPptx(vaultPath, parsedSource, sourceRecordPath, job);
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
        if (isDeterministicMediaOcrError(caught)) throw caught;
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

  async #ocrPptx(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<OcrSourceResult> {
    const existing = await this.#pptxArtifacts.readExisting(vaultPath, sourceRecord, sourceRecordPath, job);
    if (existing) return existing;
    if (!this.#officeMedia.isAvailable() || !this.#adapter.isAvailable()) {
      throw new PigeDomainError("ocr.adapter_unavailable", this.inspectSource(sourceRecord).message);
    }
    const target = await this.#pptxArtifacts.resolveTarget(vaultPath, sourceRecord);
    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, sourceRecord);
    let materialized: Awaited<ReturnType<OfficeMediaMaterializerPort["materialize"]>>;
    try {
      materialized = await this.#officeMedia.materialize(sourceSnapshot.absolutePath, target.targets);
    } finally {
      await sourceSnapshot.dispose();
    }
    const media = validateMaterializedMedia(target.targets, materialized);
    const results: PptxMediaOcrItemResult[] = [];
    for (const item of media) {
      try {
        const result = await recognizePrivateMedia(this.#adapter, item, preferredLanguages(sourceRecord));
        results.push({
          target: item,
          mediaChecksum: checksumBytes(item.bytes),
          mediaSize: item.bytes.byteLength,
          result
        });
      } catch (caught) {
        if (isUnavailableOcrError(caught)) throw caught;
        if (isDeterministicMediaOcrError(caught)) throw caught;
        throw new PigeDomainError(
          "ocr.pptx.media_failed",
          "Local OCR failed for selected PPTX media; preserved parser artifacts remain retryable."
        );
      }
    }
    return this.#pptxArtifacts.persist(vaultPath, sourceRecord, sourceRecordPath, job, results);
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

function isDeterministicMediaOcrError(caught: unknown): boolean {
  return caught instanceof PigeDomainError &&
    /^ocr\.image\.(?:source_missing|not_regular|file_too_large|invalid|unsupported_format|multiframe_unsupported|dimensions_invalid|dimensions_too_large|decode_failed)$/u.test(caught.code);
}

function validateMaterializedMedia(
  targets: readonly OfficeMediaTarget[],
  result: Awaited<ReturnType<OfficeMediaMaterializerPort["materialize"]>>
): readonly MaterializedOfficeMedia[] {
  if (
    result.materializerId !== OFFICE_MEDIA_MATERIALIZER_ID ||
    result.materializerVersion !== OFFICE_MEDIA_MATERIALIZER_VERSION ||
    result.media.length !== targets.length
  ) {
    throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "The PPTX media materializer returned an invalid target set.");
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
      throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "A materialized PPTX media item is invalid.");
    }
  }
  return result.media;
}

async function recognizePrivateMedia(
  adapter: NativeImageOcrAdapterPort,
  media: MaterializedOfficeMedia,
  languages: readonly string[]
): ReturnType<NativeImageOcrAdapterPort["recognize"]> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pige-pptx-media-"));
  const filePath = path.join(root, `media${media.extension}`);
  try {
    await fs.promises.chmod(root, 0o700).catch(() => undefined);
    await fs.promises.writeFile(filePath, media.bytes, { flag: "wx", mode: 0o600 });
    return await adapter.recognize(filePath, languages);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

function checksumBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameMediaTarget(left: OfficeMediaTarget, right: OfficeMediaTarget): boolean {
  return left.slide === right.slide &&
    left.parentLocator === right.parentLocator &&
    left.mediaIndex === right.mediaIndex &&
    left.locator === right.locator &&
    left.packagePath === right.packagePath &&
    left.size === right.size &&
    left.extension === right.extension;
}
