import fs from "node:fs";
import { PigeDomainError } from "@pige/domain";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  PDF_PARSER_ENGINE,
  PDF_PARSER_ID,
  PDF_PARSER_VERSION,
  type PdfExtractionPage,
  type PdfExtractionResult,
  type PdfParserRequest,
  type PdfTextCoverage
} from "./pdf-parser-types";

const MIN_MEANINGFUL_PAGE_CHARACTERS = 32;
const PROMPT_INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?previous|system\s+prompt|reveal\s+(?:the\s+)?(?:api\s+key|secret)|override\s+(?:the\s+)?instructions)/iu;

export async function extractPdfText(request: PdfParserRequest): Promise<PdfExtractionResult> {
  const data = await readBoundedPdfData(request.filePath, request.limits.maxBytes);
  const loadingTask = getDocument({
    data,
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    maxImageSize: 16_000_000,
    stopAtErrors: false,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: 0
  });

  try {
    const document = await loadingTask.promise;
    const processedPageCount = Math.min(document.numPages, request.limits.maxPages);
    const truncated = document.numPages > request.limits.maxPages;
    const warnings: string[] = [];
    if (truncated) {
      warnings.push(`Only the first ${request.limits.maxPages} pages were processed because the PDF exceeds the page limit.`);
    }

    const pages: PdfExtractionPage[] = [];
    for (let pageNumber = 1; pageNumber <= processedPageCount; pageNumber += 1) {
      try {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
        const text = normalizeExtractedText(joinTextItems(content.items));
        const pageWarnings: string[] = [];
        if (text.length > 0 && text.length < MIN_MEANINGFUL_PAGE_CHARACTERS) {
          pageWarnings.push("Embedded text is sparse; OCR may recover additional visible text.");
        }
        if (PROMPT_INJECTION_PATTERN.test(text)) {
          pageWarnings.push("The page contains instruction-like text and remains untrusted source content.");
        }
        pages.push({
          page: pageNumber,
          locator: `page:${pageNumber}`,
          text,
          characterCount: text.length,
          needsOcr: text.length < MIN_MEANINGFUL_PAGE_CHARACTERS,
          warnings: pageWarnings
        });
        page.cleanup();
      } catch {
        pages.push({
          page: pageNumber,
          locator: `page:${pageNumber}`,
          text: "",
          characterCount: 0,
          needsOcr: true,
          warnings: ["Embedded text extraction failed for this page; OCR is required."]
        });
      }
    }

    const metadata = await document.getMetadata().catch(() => undefined);
    const title = normalizeMetadataTitle(metadata?.info && "Title" in metadata.info ? metadata.info.Title : undefined);
    const pagesWithText = pages.filter((page) => page.characterCount > 0).length;
    const meaningfulPages = pages.filter((page) => page.characterCount >= MIN_MEANINGFUL_PAGE_CHARACTERS).length;
    const textCharacterCount = pages.reduce((total, page) => total + page.characterCount, 0);
    const textCoverage = classifyCoverage(processedPageCount, meaningfulPages, textCharacterCount);
    const ocrCandidatePages = pages.filter((page) => page.needsOcr).map((page) => page.page);
    let text = "";
    const pagesWithOffsets = pages.map((page) => {
      if (page.text.length === 0) return page;
      text += `${text.length > 0 ? "\n\n" : ""}--- Page ${page.page} ---\n`;
      const characterStart = text.length;
      text += page.text;
      return { ...page, characterStart, characterEnd: text.length };
    });
    for (const page of pagesWithOffsets) {
      for (const warning of page.warnings) {
        warnings.push(`Page ${page.page}: ${warning}`);
      }
    }
    if (textCoverage === "none") {
      warnings.push("No embedded text was found; OCR is required before Agent ingest.");
    } else if (textCoverage === "low") {
      warnings.push("Embedded text coverage is low; OCR is required before Agent ingest.");
    } else if (ocrCandidatePages.length > 0) {
      warnings.push("Some pages have sparse embedded text and were handed off for OCR enrichment.");
    }

    const result: PdfExtractionResult = {
      parserId: PDF_PARSER_ID,
      engine: PDF_PARSER_ENGINE,
      engineVersion: PDF_PARSER_VERSION,
      pageCount: document.numPages,
      processedPageCount,
      pagesWithText,
      textCharacterCount,
      textCoverage,
      truncated,
      needsOcr: ocrCandidatePages.length > 0,
      agentTextReady: textCoverage === "medium" || textCoverage === "high",
      ocrCandidatePages,
      ...(title ? { title } : {}),
      text,
      pages: pagesWithOffsets,
      warnings: uniqueWarnings(warnings)
    };
    await loadingTask.destroy();
    return result;
  } catch (caught) {
    await loadingTask.destroy().catch(() => undefined);
    throw normalizePdfError(caught);
  }
}

async function readBoundedPdfData(filePath: string, maxBytes: number): Promise<Uint8Array> {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(filePath, flags);
  } catch {
    throw new PigeDomainError("parser.pdf.source_missing", "The preserved PDF source is unavailable.");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) {
      throw new PigeDomainError("parser.pdf.source_missing", "The preserved PDF source is unavailable.");
    }
    if (stat.size > maxBytes) {
      throw new PigeDomainError("parser.pdf.file_too_large", "The PDF exceeds the configured local parser size limit.");
    }
    const bytes = Buffer.alloc(stat.size);
    let position = 0;
    while (position < stat.size) {
      const result = await file.read(bytes, position, stat.size - position, position);
      if (result.bytesRead === 0) break;
      position += result.bytesRead;
    }
    const after = await file.stat();
    if (
      position !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    ) {
      throw new PigeDomainError("parser.pdf.source_changed", "The preserved PDF changed while it was being read.");
    }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await file.close();
  }
}

function joinTextItems(items: readonly unknown[]): string {
  let text = "";
  for (const item of items) {
    if (!isTextItem(item)) continue;
    const value = item.str.replaceAll("\u0000", "");
    if (value.length > 0) {
      const previous = text.at(-1);
      const next = value[0];
      if (previous && next && shouldInsertSpace(previous, next)) text += " ";
      text += value;
    }
    if (item.hasEOL && !text.endsWith("\n")) text += "\n";
  }
  return text;
}

function isTextItem(value: unknown): value is { readonly str: string; readonly hasEOL: boolean } {
  return typeof value === "object" && value !== null &&
    "str" in value && typeof value.str === "string" &&
    "hasEOL" in value && typeof value.hasEOL === "boolean";
}

function shouldInsertSpace(previous: string, next: string): boolean {
  if (/\s/u.test(previous) || /\s/u.test(next)) return false;
  if (isCjk(previous) && isCjk(next)) return false;
  if (/^[,.;:!?%\)\]\}，。；：！？、）》】]/u.test(next)) return false;
  if (/[\(\[\{（《【]$/u.test(previous)) return false;
  return true;
}

function isCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function normalizeExtractedText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeMetadataTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 240);
}

function classifyCoverage(pageCount: number, meaningfulPages: number, textCharacterCount: number): PdfTextCoverage {
  if (pageCount === 0 || textCharacterCount === 0) return "none";
  const ratio = meaningfulPages / pageCount;
  if (ratio >= 0.9) return "high";
  if (ratio >= 0.5 || (meaningfulPages > 0 && textCharacterCount >= 500)) return "medium";
  return "low";
}

function uniqueWarnings(warnings: readonly string[]): string[] {
  return Array.from(new Set(warnings)).slice(0, 64);
}

function normalizePdfError(caught: unknown): PigeDomainError {
  if (caught instanceof PigeDomainError) return caught;
  const name = caught instanceof Error ? caught.name : "";
  if (name === "PasswordException") {
    return new PigeDomainError("parser.pdf.password_required", "The PDF is encrypted and requires a password.");
  }
  if (name === "InvalidPDFException") {
    return new PigeDomainError("parser.pdf.invalid", "The preserved file is not a valid readable PDF.");
  }
  if (name === "MissingPDFException") {
    return new PigeDomainError("parser.pdf.source_missing", "The preserved PDF source is unavailable.");
  }
  return new PigeDomainError("parser.pdf.failed", "PDF text extraction failed.");
}
