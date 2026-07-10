export const WEB_EXTRACTOR_ID = "mozilla_readability";
export const READABILITY_VERSION = "0.6.0";
export const JSDOM_VERSION = "29.1.1";
export const WEB_EXTRACTOR_ENGINE = "@mozilla/readability+jsdom";
export const WEB_EXTRACTOR_VERSION = `${READABILITY_VERSION}+${JSDOM_VERSION}`;
export const WEB_EXTRACTOR_MAX_INPUT_CHARACTERS = 2 * 1024 * 1024;
export const WEB_EXTRACTOR_MAX_ELEMENTS = 20_000;
export const WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS = 1_000_000;
export const WEB_EXTRACTOR_MAX_IMAGE_REFERENCES = 64;
export const WEB_EXTRACTOR_MAX_PENDING = 8;
export const WEB_EXTRACTOR_TIMEOUT_MS = 5_000;

export interface WebExtractorLimits {
  readonly maxInputCharacters: number;
  readonly maxElements: number;
  readonly maxOutputCharacters: number;
  readonly maxImageReferences: number;
}

export interface WebExtractorRequest {
  readonly requestId: string;
  readonly html: string;
  readonly url: string;
  readonly limits: WebExtractorLimits;
}

export interface WebExtractionResult {
  readonly parserId: typeof WEB_EXTRACTOR_ID;
  readonly engine: typeof WEB_EXTRACTOR_ENGINE;
  readonly engineVersion: typeof WEB_EXTRACTOR_VERSION;
  readonly mode: "readability" | "dom_fallback";
  readonly title?: string;
  readonly canonicalUrl?: string;
  readonly byline?: string;
  readonly siteName?: string;
  readonly language?: string;
  readonly publishedTime?: string;
  readonly excerpt?: string;
  readonly text: string;
  readonly textCharacterCount: number;
  readonly elementCount: number;
  readonly truncated: boolean;
  readonly imageReferences: readonly string[];
  readonly warnings: readonly string[];
}

export interface WebExtractorWorkerSuccess {
  readonly requestId: string;
  readonly ok: true;
  readonly result: WebExtractionResult;
}

export interface WebExtractorWorkerFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type WebExtractorWorkerResponse = WebExtractorWorkerSuccess | WebExtractorWorkerFailure;
