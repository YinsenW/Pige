import type { SourceKind } from "@pige/schemas";
import type { ParserTextCoverage } from "./parser-artifact-service";

export const OFFICE_PARSER_ID = "office_openxml";
export const MAMMOTH_VERSION = "1.12.0";
export const FAST_XML_PARSER_VERSION = "5.10.1";
export const YAUZL_VERSION = "3.4.0";
export const OFFICE_PARSER_ENGINE = "mammoth+fast-xml-parser+yauzl";
export const OFFICE_PARSER_VERSION = `${MAMMOTH_VERSION}+${FAST_XML_PARSER_VERSION}+${YAUZL_VERSION}`;
export const OFFICE_PARSER_MAX_BYTES = 100 * 1024 * 1024;
export const OFFICE_PARSER_MAX_ENTRIES = 10_000;
export const OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
export const OFFICE_PARSER_MAX_XML_ENTRY_BYTES = 10 * 1024 * 1024;
export const OFFICE_PARSER_MAX_SELECTED_XML_BYTES = 128 * 1024 * 1024;
export const OFFICE_PARSER_MAX_SLIDES = 2_000;
export const OFFICE_PARSER_MAX_TEXT_CHARACTERS = 10_000_000;
export const OFFICE_PARSER_TIMEOUT_MS = 60_000;
export const OFFICE_MEDIA_TARGET_SCHEMA_VERSION = 1;
export const OFFICE_MEDIA_MATERIALIZER_ID = "office_openxml_media";
export const OFFICE_MEDIA_MATERIALIZER_VERSION = "1";
export const OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS = 20;
export const OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM = 16 * 1024 * 1024;
export const OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const OFFICE_MEDIA_MATERIALIZER_TIMEOUT_MS = 60_000;
export const OFFICE_MEDIA_OCR_EXTENSIONS = [
  ".bmp",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp"
] as const;

export interface OfficeParserLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxXmlEntryBytes: number;
  readonly maxSelectedXmlBytes: number;
  readonly maxSlides: number;
  readonly maxTextCharacters: number;
}

export interface OfficeParserRequest {
  readonly requestId: string;
  readonly filePath: string;
  readonly sourceKind: Extract<SourceKind, "docx_file" | "pptx_file">;
  readonly limits: OfficeParserLimits;
}

export interface OfficeExtractionUnit {
  readonly index: number;
  readonly locator: string;
  readonly kind: "heading" | "paragraph" | "list_item" | "table" | "slide";
  readonly characterStart: number;
  readonly characterEnd: number;
  readonly characterCount: number;
  readonly imageCount: number;
  readonly notesCharacterCount?: number;
  readonly mediaReferences?: readonly OfficeUnitMediaReference[];
  readonly needsOcr: boolean;
  readonly warnings: readonly string[];
}

export interface OfficeUnitMediaReference {
  readonly mediaIndex: number;
  readonly locator: string;
  readonly packagePath: string;
  readonly size: number;
  readonly extension: string;
}

export interface OfficeMediaReference {
  readonly packagePath: string;
  readonly size: number;
  readonly extension: string;
}

export interface OfficeExtractionResult {
  readonly parserId: typeof OFFICE_PARSER_ID;
  readonly engine: typeof OFFICE_PARSER_ENGINE;
  readonly engineVersion: typeof OFFICE_PARSER_VERSION;
  readonly format: "docx" | "pptx";
  readonly title?: string;
  readonly text: string;
  readonly textCharacterCount: number;
  readonly textCoverage: ParserTextCoverage;
  readonly truncated: boolean;
  readonly needsOcr: boolean;
  readonly agentTextReady: boolean;
  readonly ocrCandidateLocators: readonly string[];
  readonly unitCount: number;
  readonly processedUnitCount: number;
  readonly unitsWithText: number;
  readonly units: readonly OfficeExtractionUnit[];
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly mediaReferences: readonly OfficeMediaReference[];
  readonly structure: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export interface OfficeParserWorkerSuccess {
  readonly requestId: string;
  readonly ok: true;
  readonly result: OfficeExtractionResult;
}

export interface OfficeParserWorkerFailure {
  readonly requestId: string;
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type OfficeParserWorkerResponse = OfficeParserWorkerSuccess | OfficeParserWorkerFailure;

export interface OfficeMediaTarget extends OfficeUnitMediaReference {
  readonly slide: number;
  readonly parentLocator: string;
}

export interface OfficeMediaMaterializerLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxTargets: number;
  readonly maxBytesPerItem: number;
  readonly maxTotalBytes: number;
}

export interface OfficeMediaMaterializerRequest {
  readonly operation: "materialize_pptx_media";
  readonly requestId: string;
  readonly filePath: string;
  readonly sourceKind: "pptx_file";
  readonly targets: readonly OfficeMediaTarget[];
  readonly limits: OfficeMediaMaterializerLimits;
}

export interface MaterializedOfficeMedia extends OfficeMediaTarget {
  readonly bytes: Uint8Array;
}

export interface OfficeMediaMaterializerResult {
  readonly materializerId: typeof OFFICE_MEDIA_MATERIALIZER_ID;
  readonly materializerVersion: typeof OFFICE_MEDIA_MATERIALIZER_VERSION;
  readonly media: readonly MaterializedOfficeMedia[];
}

export interface OfficeMediaWorkerSuccess {
  readonly operation: "materialize_pptx_media";
  readonly requestId: string;
  readonly ok: true;
  readonly result: OfficeMediaMaterializerResult;
}

export interface OfficeMediaWorkerFailure {
  readonly operation: "materialize_pptx_media";
  readonly requestId: string;
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type OfficeMediaWorkerResponse = OfficeMediaWorkerSuccess | OfficeMediaWorkerFailure;
export type OfficeWorkerRequest = OfficeParserRequest | OfficeMediaMaterializerRequest;
