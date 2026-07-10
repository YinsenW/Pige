import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import type { Canvas } from "@napi-rs/canvas";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api.d.ts";
import {
  PDF_PAGE_RENDERER_ERROR_MESSAGES,
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_MAX_EDGE,
  PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES,
  PDF_PAGE_RENDERER_MAX_PAGES,
  PDF_PAGE_RENDERER_MAX_PDF_BYTES,
  PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_VERSION,
  type PdfPageRendererErrorCode,
  type PdfPageRendererLimits,
  type PdfPageRendererRequest,
  type PdfPageRendererResult,
  type PdfPageRendererWarning,
  type PdfRenderedPage
} from "./pdf-page-renderer-types";

interface RendererDependencies {
  readonly pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  readonly canvas: typeof import("@napi-rs/canvas");
}

let rendererDependencies: Promise<RendererDependencies> | undefined;

export async function renderPdfPages(value: unknown): Promise<PdfPageRendererResult> {
  const request = parsePdfPageRendererRequest(value);
  const bytes = await readBoundedPdf(request.filePath, request.limits.maxPdfBytes);
  let dependencies: RendererDependencies;
  try {
    dependencies = await loadRendererDependencies();
  } catch {
    throw rendererError("parser.pdf_page_renderer.failed");
  }
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let document: PDFDocumentProxy | undefined;

  try {
    loadingTask = dependencies.pdfjs.getDocument({
      data: bytes,
      canvasMaxAreaInBytes: PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE * 4,
      disableAutoFetch: true,
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
      isImageDecoderSupported: false,
      isOffscreenCanvasSupported: false,
      maxImageSize: PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
      stopAtErrors: true,
      useSystemFonts: false,
      useWasm: false,
      useWorkerFetch: false,
      verbosity: 0
    });
    document = await loadingTask.promise;
    validatePageRange(request.pageCandidates, document.numPages);

    const requestedPages = request.pageCandidates.slice(0, request.limits.maxPages);
    const warnings: PdfPageRendererWarning[] = [];
    let truncated = request.pageCandidates.length > requestedPages.length;
    if (truncated) warnings.push({ code: "page_limit_truncated" });

    const pages: PdfRenderedPage[] = [];
    let totalPngByteSize = 0;
    for (const pageNumber of requestedPages) {
      let page: PDFPageProxy | undefined;
      let canvas: Canvas | undefined;
      try {
        page = await document.getPage(pageNumber);
        const renderSize = boundedRenderSize(page, request.limits);
        canvas = dependencies.canvas.createCanvas(renderSize.width, renderSize.height);
        await page.render({
          annotationMode: dependencies.pdfjs.AnnotationMode.DISABLE,
          background: "#ffffff",
          canvas: canvas as unknown as HTMLCanvasElement,
          intent: "display",
          viewport: renderSize.viewport
        }).promise;

        const encoded = canvas.toBuffer("image/png");
        if (encoded.byteLength > request.limits.maxPngBytesPerPage) {
          warnings.push({ code: "page_png_limit_exceeded", page: pageNumber });
          truncated = true;
          continue;
        }
        if (totalPngByteSize + encoded.byteLength > request.limits.maxTotalPngBytes) {
          warnings.push({ code: "total_png_limit_exceeded", page: pageNumber });
          truncated = true;
          break;
        }

        const png = Uint8Array.from(encoded);
        totalPngByteSize += png.byteLength;
        pages.push({
          requestedPage: pageNumber,
          renderedPage: pageNumber,
          locator: `page:${pageNumber}`,
          mimeType: "image/png",
          png,
          width: renderSize.width,
          height: renderSize.height,
          pngByteSize: png.byteLength
        });
      } catch {
        warnings.push({ code: "page_render_failed", page: pageNumber });
        truncated = true;
      } finally {
        try {
          page?.cleanup();
        } catch {
          // The worker is about to release the document and must preserve the original outcome.
        }
        releaseCanvas(canvas);
      }
    }

    return {
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      rendererId: PDF_PAGE_RENDERER_ID,
      rendererVersion: PDF_PAGE_RENDERER_VERSION,
      pageCount: document.numPages,
      requestedPages,
      renderedPages: pages.map((page) => page.renderedPage),
      pages,
      totalPngByteSize,
      warnings,
      truncated
    };
  } catch (caught) {
    throw normalizePdfRendererError(caught);
  } finally {
    await document?.cleanup().catch(() => undefined);
    await loadingTask?.destroy().catch(() => undefined);
    try {
      dependencies.canvas.clearAllCache();
    } catch {
      // The dedicated worker terminates after this request, so no cache survives the boundary.
    }
  }
}

function parsePdfPageRendererRequest(value: unknown): PdfPageRendererRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["protocolVersion", "requestId", "filePath", "pageCandidates", "limits"])) {
    throw rendererError("parser.pdf_page_renderer.invalid_request");
  }
  if (
    value.protocolVersion !== PDF_PAGE_RENDERER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    typeof value.filePath !== "string" ||
    value.filePath.length === 0 ||
    value.filePath.length > 32_768 ||
    value.filePath.includes("\u0000") ||
    !path.isAbsolute(value.filePath) ||
    !Array.isArray(value.pageCandidates) ||
    value.pageCandidates.length === 0 ||
    value.pageCandidates.length > PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES ||
    !isRecord(value.limits)
  ) {
    throw rendererError("parser.pdf_page_renderer.invalid_request");
  }

  const pageCandidates = parseStrictPageCandidates(value.pageCandidates);
  const limits = parseLimits(value.limits);
  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    requestId: value.requestId,
    filePath: value.filePath,
    pageCandidates,
    limits
  };
}

function parseStrictPageCandidates(values: readonly unknown[]): number[] {
  const pages: number[] = [];
  let previous = 0;
  for (const value of values) {
    if (!isPositiveSafeInteger(value) || value <= previous) {
      throw rendererError("parser.pdf_page_renderer.invalid_request");
    }
    pages.push(value);
    previous = value;
  }
  return pages;
}

function parseLimits(value: Record<string, unknown>): PdfPageRendererLimits {
  if (!hasExactKeys(value, [
    "maxPdfBytes",
    "maxPages",
    "maxEdge",
    "maxPixelsPerPage",
    "maxPngBytesPerPage",
    "maxTotalPngBytes"
  ])) {
    throw rendererError("parser.pdf_page_renderer.invalid_request");
  }
  const limits = {
    maxPdfBytes: value.maxPdfBytes,
    maxPages: value.maxPages,
    maxEdge: value.maxEdge,
    maxPixelsPerPage: value.maxPixelsPerPage,
    maxPngBytesPerPage: value.maxPngBytesPerPage,
    maxTotalPngBytes: value.maxTotalPngBytes
  };
  if (
    !boundedPositiveInteger(limits.maxPdfBytes, PDF_PAGE_RENDERER_MAX_PDF_BYTES) ||
    !boundedPositiveInteger(limits.maxPages, PDF_PAGE_RENDERER_MAX_PAGES) ||
    !boundedPositiveInteger(limits.maxEdge, PDF_PAGE_RENDERER_MAX_EDGE) ||
    !boundedPositiveInteger(limits.maxPixelsPerPage, PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE) ||
    !boundedPositiveInteger(limits.maxPngBytesPerPage, PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE) ||
    !boundedPositiveInteger(limits.maxTotalPngBytes, PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES)
  ) {
    throw rendererError("parser.pdf_page_renderer.invalid_request");
  }
  return limits as PdfPageRendererLimits;
}

async function readBoundedPdf(filePath: string, maxPdfBytes: number): Promise<Uint8Array> {
  let pathStat: fs.Stats;
  try {
    pathStat = await fs.promises.lstat(filePath);
  } catch {
    throw rendererError("parser.pdf_page_renderer.source_missing");
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
    throw rendererError("parser.pdf_page_renderer.source_missing");
  }
  if (pathStat.size > maxPdfBytes) throw rendererError("parser.pdf_page_renderer.file_too_large");

  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino
    ) {
      throw rendererError("parser.pdf_page_renderer.source_missing");
    }
    if (openedStat.size > maxPdfBytes) throw rendererError("parser.pdf_page_renderer.file_too_large");
    const data = await handle.readFile();
    if (data.byteLength > maxPdfBytes) throw rendererError("parser.pdf_page_renderer.file_too_large");
    return Uint8Array.from(data);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw rendererError("parser.pdf_page_renderer.source_missing");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function loadRendererDependencies(): Promise<RendererDependencies> {
  rendererDependencies ??= (async () => {
    process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
    const canvas = createRequire(import.meta.url)("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (pdfjs.version !== "6.1.200") throw rendererError("parser.pdf_page_renderer.failed");
    return { pdfjs, canvas };
  })();
  return rendererDependencies;
}

function validatePageRange(pageCandidates: readonly number[], pageCount: number): void {
  if (!isPositiveSafeInteger(pageCount) || pageCandidates.some((page) => page > pageCount)) {
    throw rendererError("parser.pdf_page_renderer.page_out_of_range");
  }
}

function boundedRenderSize(page: PDFPageProxy, limits: PdfPageRendererLimits) {
  const baseViewport = page.getViewport({ scale: 1 });
  if (
    !Number.isFinite(baseViewport.width) ||
    !Number.isFinite(baseViewport.height) ||
    baseViewport.width <= 0 ||
    baseViewport.height <= 0
  ) {
    throw rendererError("parser.pdf_page_renderer.failed");
  }
  const scale = Math.min(
    limits.maxEdge / baseViewport.width,
    limits.maxEdge / baseViewport.height,
    Math.sqrt(limits.maxPixelsPerPage / (baseViewport.width * baseViewport.height))
  );
  if (!Number.isFinite(scale) || scale <= 0) throw rendererError("parser.pdf_page_renderer.failed");

  const width = Math.max(1, Math.floor(baseViewport.width * scale));
  const height = Math.max(1, Math.floor(baseViewport.height * scale));
  if (
    width > limits.maxEdge ||
    height > limits.maxEdge ||
    width > Math.floor(limits.maxPixelsPerPage / height)
  ) {
    throw rendererError("parser.pdf_page_renderer.failed");
  }
  const viewportScale = Math.min(width / baseViewport.width, height / baseViewport.height);
  return {
    width,
    height,
    viewport: page.getViewport({ scale: viewportScale })
  };
}

function normalizePdfRendererError(caught: unknown): PigeDomainError {
  if (caught instanceof PigeDomainError) return caught;
  const name = caught instanceof Error ? caught.name : "";
  if (name === "PasswordException") return rendererError("parser.pdf_page_renderer.password_required");
  if (name === "InvalidPDFException") return rendererError("parser.pdf_page_renderer.invalid_pdf");
  if (name === "MissingPDFException") return rendererError("parser.pdf_page_renderer.source_missing");
  return rendererError("parser.pdf_page_renderer.failed");
}

function rendererError(code: PdfPageRendererErrorCode): PigeDomainError {
  return new PigeDomainError(code, PDF_PAGE_RENDERER_ERROR_MESSAGES[code]);
}

function releaseCanvas(canvas: Canvas | undefined): void {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // The dedicated worker is still terminated by the service after the response.
  }
}

function boundedPositiveInteger(value: unknown, maximum: number): value is number {
  return isPositiveSafeInteger(value) && value <= maximum;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
