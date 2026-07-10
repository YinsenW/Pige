import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { renderPdfPages } from "../../apps/desktop/src/main/services/pdf-page-renderer-core";
import {
  PDF_PAGE_RENDERER_DEFAULT_LIMITS,
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_VERSION,
  type PdfPageRendererLimits,
  type PdfPageRendererRequest
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";
import { createJpegScanPdf } from "./helpers/pdf-image-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";

const tempRoots: string[] = [];
let requestSequence = 0;

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PDF page renderer core", () => {
  it("renders a real embedded JPEG scan into bounded PNG pixels", async () => {
    const filePath = writeTempPdf(createJpegScanPdf());
    const result = await renderPdfPages(request(filePath, [1], {
      maxEdge: 320,
      maxPixelsPerPage: 320 * 180
    }));

    expect(result).toMatchObject({
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      rendererId: PDF_PAGE_RENDERER_ID,
      rendererVersion: PDF_PAGE_RENDERER_VERSION,
      pageCount: 1,
      requestedPages: [1],
      renderedPages: [1],
      truncated: false,
      warnings: []
    });
    const page = result.pages[0];
    if (!page) throw new Error("Expected one rendered page.");
    expect(page).toMatchObject({
      requestedPage: 1,
      renderedPage: 1,
      locator: "page:1",
      mimeType: "image/png",
      width: 320,
      height: 180,
      pngByteSize: page.png.byteLength
    });
    expect(Array.from(page.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const image = await loadImage(Buffer.from(page.png));
    const decoded = createCanvas(page.width, page.height);
    const context = decoded.getContext("2d");
    context.drawImage(image, 0, 0);
    const left = context.getImageData(24, 24, 1, 1).data;
    const right = context.getImageData(page.width - 24, 24, 1, 1).data;
    expect(left[0]).toBeGreaterThan(left[2] ?? 0);
    expect(right[2]).toBeGreaterThan(right[0] ?? 0);
    decoded.width = 0;
    decoded.height = 0;
  });

  it("truncates an ascending candidate list at the page limit with an explicit warning", async () => {
    const filePath = writeTempPdf(createTestPdf(["", "", "", ""]));
    const result = await renderPdfPages(request(filePath, [1, 2, 3, 4], {
      maxPages: 2,
      maxEdge: 16,
      maxPixelsPerPage: 256
    }));

    expect(result.pageCount).toBe(4);
    expect(result.requestedPages).toEqual([1, 2]);
    expect(result.renderedPages).toEqual([1, 2]);
    expect(result.warnings).toContainEqual({ code: "page_limit_truncated" });
    expect(result.truncated).toBe(true);
  });

  it("rejects non-canonical and out-of-range page lists", async () => {
    const filePath = writeTempPdf(createJpegScanPdf());

    await expect(renderPdfPages(request(filePath, [1, 1]))).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pdf_page_renderer.invalid_request"
    });
    await expect(renderPdfPages(request(filePath, [2]))).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pdf_page_renderer.page_out_of_range"
    });
  });

  it("rejects a symlink before PDF.js reads the target", async () => {
    const targetPath = writeTempPdf(createJpegScanPdf());
    const symlinkPath = path.join(path.dirname(targetPath), "linked-fixture.pdf");
    try {
      fs.symlinkSync(targetPath, symlinkPath, "file");
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === "EPERM") return;
      throw caught;
    }

    await expect(renderPdfPages(request(symlinkPath, [1]))).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pdf_page_renderer.source_missing"
    });
  });

  it("enforces file, dimension, per-page PNG, and aggregate PNG limits", async () => {
    const filePath = writeTempPdf(createJpegScanPdf(2));

    await expect(renderPdfPages(request(filePath, [1], { maxPdfBytes: 16 }))).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pdf_page_renderer.file_too_large"
    });

    const dimensionBounded = await renderPdfPages(request(filePath, [1], {
      maxEdge: 64,
      maxPixelsPerPage: 2_000
    }));
    const boundedPage = dimensionBounded.pages[0];
    if (!boundedPage) throw new Error("Expected a dimension-bounded page.");
    expect(Math.max(boundedPage.width, boundedPage.height)).toBeLessThanOrEqual(64);
    expect(boundedPage.width * boundedPage.height).toBeLessThanOrEqual(2_000);

    const pageByteBounded = await renderPdfPages(request(filePath, [1], {
      maxEdge: 64,
      maxPixelsPerPage: 2_000,
      maxPngBytesPerPage: 8
    }));
    expect(pageByteBounded.pages).toEqual([]);
    expect(pageByteBounded.warnings).toContainEqual({ code: "page_png_limit_exceeded", page: 1 });
    expect(pageByteBounded.truncated).toBe(true);

    const aggregateBounded = await renderPdfPages(request(filePath, [1, 2], {
      maxEdge: 64,
      maxPixelsPerPage: 2_000,
      maxTotalPngBytes: 8
    }));
    expect(aggregateBounded.pages).toEqual([]);
    expect(aggregateBounded.warnings).toContainEqual({ code: "total_png_limit_exceeded", page: 1 });
    expect(aggregateBounded.truncated).toBe(true);
  });

  it("maps a damaged PDF to a stable error without exposing parser details", async () => {
    const filePath = writeTempPdf(Buffer.from("%PDF-1.7\nnot a valid document", "ascii"));

    await expect(renderPdfPages(request(filePath, [1]))).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pdf_page_renderer.invalid_pdf",
      message: "The preserved file is not a valid readable PDF."
    });
  });
});

function request(
  filePath: string,
  pageCandidates: readonly number[],
  overrides: Partial<PdfPageRendererLimits> = {}
): PdfPageRendererRequest {
  requestSequence += 1;
  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    requestId: `core-test-${requestSequence}`,
    filePath,
    pageCandidates,
    limits: { ...PDF_PAGE_RENDERER_DEFAULT_LIMITS, ...overrides }
  };
}

function writeTempPdf(contents: Buffer): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pdf-page-renderer-test-"));
  tempRoots.push(root);
  const filePath = path.join(root, "fixture.pdf");
  fs.writeFileSync(filePath, contents);
  return filePath;
}
