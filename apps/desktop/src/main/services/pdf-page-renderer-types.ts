export const PDF_PAGE_RENDERER_PROTOCOL_VERSION = 1;
export const PDF_PAGE_RENDERER_ID = "pdfjs_napi_canvas";
export const PDF_PAGE_RENDERER_VERSION = "pdfjs-dist@6.1.200+@napi-rs/canvas@1.0.2";

export const PDF_PAGE_RENDERER_MAX_PDF_BYTES = 200 * 1024 * 1024;
export const PDF_PAGE_RENDERER_MAX_PAGES = 20;
export const PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES = 10_000;
export const PDF_PAGE_RENDERER_MAX_EDGE = 3_072;
export const PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE = 9_437_184;
export const PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE = 16 * 1024 * 1024;
export const PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES = 64 * 1024 * 1024;
export const PDF_PAGE_RENDERER_TIMEOUT_MS = 120_000;
export const PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB = 512;

export interface PdfPageRendererLimits {
  readonly maxPdfBytes: number;
  readonly maxPages: number;
  readonly maxEdge: number;
  readonly maxPixelsPerPage: number;
  readonly maxPngBytesPerPage: number;
  readonly maxTotalPngBytes: number;
}

export const PDF_PAGE_RENDERER_DEFAULT_LIMITS: PdfPageRendererLimits = Object.freeze({
  maxPdfBytes: PDF_PAGE_RENDERER_MAX_PDF_BYTES,
  maxPages: PDF_PAGE_RENDERER_MAX_PAGES,
  maxEdge: PDF_PAGE_RENDERER_MAX_EDGE,
  maxPixelsPerPage: PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
  maxPngBytesPerPage: PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE,
  maxTotalPngBytes: PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES
});

export type PdfPageRendererWarningCode =
  | "page_candidates_deduplicated"
  | "page_candidates_sorted"
  | "page_limit_truncated"
  | "page_render_failed"
  | "page_png_limit_exceeded"
  | "total_png_limit_exceeded";

export interface PdfPageRendererWarning {
  readonly code: PdfPageRendererWarningCode;
  readonly page?: number;
}

export interface PdfPageRendererRequest {
  readonly protocolVersion: typeof PDF_PAGE_RENDERER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly filePath: string;
  readonly pageCandidates: readonly number[];
  readonly limits: PdfPageRendererLimits;
}

export interface PdfRenderedPage {
  readonly requestedPage: number;
  readonly renderedPage: number;
  readonly locator: string;
  readonly mimeType: "image/png";
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly pngByteSize: number;
}

export interface PdfPageRendererResult {
  readonly protocolVersion: typeof PDF_PAGE_RENDERER_PROTOCOL_VERSION;
  readonly rendererId: typeof PDF_PAGE_RENDERER_ID;
  readonly rendererVersion: typeof PDF_PAGE_RENDERER_VERSION;
  readonly pageCount: number;
  readonly requestedPages: readonly number[];
  readonly renderedPages: readonly number[];
  readonly pages: readonly PdfRenderedPage[];
  readonly totalPngByteSize: number;
  readonly warnings: readonly PdfPageRendererWarning[];
  readonly truncated: boolean;
}

export const PDF_PAGE_RENDERER_ERROR_MESSAGES = {
  "parser.pdf_page_renderer.invalid_request": "The PDF page renderer request is invalid.",
  "parser.pdf_page_renderer.invalid_page": "PDF page candidates must be positive whole page numbers.",
  "parser.pdf_page_renderer.source_missing": "The preserved PDF source is unavailable.",
  "parser.pdf_page_renderer.file_too_large": "The PDF exceeds the local page renderer size limit.",
  "parser.pdf_page_renderer.password_required": "The PDF is encrypted and requires a password.",
  "parser.pdf_page_renderer.invalid_pdf": "The preserved file is not a valid readable PDF.",
  "parser.pdf_page_renderer.page_out_of_range": "A requested PDF page is outside the document page range.",
  "parser.pdf_page_renderer.failed": "PDF page rendering failed.",
  "parser.pdf_page_renderer.unavailable": "The bundled PDF page renderer is unavailable.",
  "parser.pdf_page_renderer.timeout": "PDF page rendering exceeded the local time limit.",
  "parser.pdf_page_renderer.worker_protocol": "The PDF page renderer worker returned an invalid response.",
  "parser.pdf_page_renderer.worker_failed": "The PDF page renderer worker failed."
} as const;

export type PdfPageRendererErrorCode = keyof typeof PDF_PAGE_RENDERER_ERROR_MESSAGES;

export interface PdfPageRendererWorkerSuccess {
  readonly protocolVersion: typeof PDF_PAGE_RENDERER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: true;
  readonly result: PdfPageRendererResult;
}

export interface PdfPageRendererWorkerFailure {
  readonly protocolVersion: typeof PDF_PAGE_RENDERER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: false;
  readonly error: {
    readonly code: PdfPageRendererErrorCode;
    readonly message: string;
  };
}

export type PdfPageRendererWorkerResponse =
  | PdfPageRendererWorkerSuccess
  | PdfPageRendererWorkerFailure;
