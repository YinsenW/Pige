export const PDF_PARSER_ID = "pdfjs_text";
export const PDF_PARSER_ENGINE = "pdfjs-dist";
export const PDF_PARSER_VERSION = "6.1.200";
export const PDF_PARSER_MAX_BYTES = 200 * 1024 * 1024;
export const PDF_PARSER_MAX_PAGES = 2_000;
export const PDF_PARSER_TIMEOUT_MS = 60_000;

export interface PdfParserLimits {
  readonly maxBytes: number;
  readonly maxPages: number;
}

export interface PdfParserRequest {
  readonly requestId: string;
  readonly filePath: string;
  readonly limits: PdfParserLimits;
}

export interface PdfExtractionPage {
  readonly page: number;
  readonly locator: string;
  readonly text: string;
  readonly characterCount: number;
  readonly characterStart?: number;
  readonly characterEnd?: number;
  readonly needsOcr: boolean;
  readonly warnings: readonly string[];
}

export type PdfTextCoverage = "none" | "low" | "medium" | "high";

export interface PdfExtractionResult {
  readonly parserId: typeof PDF_PARSER_ID;
  readonly engine: typeof PDF_PARSER_ENGINE;
  readonly engineVersion: typeof PDF_PARSER_VERSION;
  readonly pageCount: number;
  readonly processedPageCount: number;
  readonly pagesWithText: number;
  readonly textCharacterCount: number;
  readonly textCoverage: PdfTextCoverage;
  readonly truncated: boolean;
  readonly needsOcr: boolean;
  readonly agentTextReady: boolean;
  readonly ocrCandidatePages: readonly number[];
  readonly title?: string;
  readonly text: string;
  readonly pages: readonly PdfExtractionPage[];
  readonly warnings: readonly string[];
}

export interface PdfParserWorkerSuccess {
  readonly requestId: string;
  readonly ok: true;
  readonly result: PdfExtractionResult;
}

export interface PdfParserWorkerFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type PdfParserWorkerResponse = PdfParserWorkerSuccess | PdfParserWorkerFailure;
