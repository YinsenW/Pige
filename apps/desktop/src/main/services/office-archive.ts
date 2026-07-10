import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { openPromise, validateFileName, type Entry } from "yauzl";
import type { OfficeMediaReference, OfficeParserLimits } from "./office-parser-types";

const MAX_COMPRESSION_RATIO = 1_000;
const COMPRESSION_RATIO_MIN_BYTES = 1024 * 1024;
const MAX_ENTRY_NAME_LENGTH = 1_024;

export interface OpenXmlPackage {
  readonly entries: ReadonlyMap<string, string>;
  readonly entryNames: ReadonlySet<string>;
  readonly entryCount: number;
  readonly totalUncompressedBytes: number;
  readonly mediaReferences: readonly OfficeMediaReference[];
}

export async function readOpenXmlPackage(
  filePath: string,
  format: "docx" | "pptx",
  limits: OfficeParserLimits
): Promise<OpenXmlPackage> {
  let zipFile;
  try {
    zipFile = await openPromise(filePath, {
      autoClose: false,
      lazyEntries: true,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true
    });
  } catch {
    throw new PigeDomainError(`parser.${format}.invalid_archive`, `The preserved ${format.toUpperCase()} file is not a valid OpenXML archive.`);
  }

  try {
    if (zipFile.entryCount > limits.maxEntries) {
      throw new PigeDomainError(`parser.${format}.too_many_entries`, `The ${format.toUpperCase()} package exceeds the parser entry limit.`);
    }
    const selected = new Map<string, string>();
    const entryNames = new Set<string>();
    const mediaReferences: OfficeMediaReference[] = [];
    let totalUncompressedBytes = 0;
    let selectedXmlBytes = 0;
    let entryCount = 0;

    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw new PigeDomainError(`parser.${format}.too_many_entries`, `The ${format.toUpperCase()} package exceeds the parser entry limit.`);
      }
      validateArchiveEntry(entry, format, limits);
      if (entryNames.has(entry.fileName)) {
        throw new PigeDomainError(`parser.${format}.duplicate_entry`, `The ${format.toUpperCase()} package contains duplicate parts.`);
      }
      entryNames.add(entry.fileName);
      totalUncompressedBytes += entry.uncompressedSize;
      if (totalUncompressedBytes > limits.maxUncompressedBytes) {
        throw new PigeDomainError(`parser.${format}.expanded_too_large`, `The expanded ${format.toUpperCase()} package exceeds the parser limit.`);
      }
      if (isMediaEntry(entry.fileName, format)) {
        mediaReferences.push({
          packagePath: entry.fileName,
          size: entry.uncompressedSize,
          extension: path.posix.extname(entry.fileName).toLocaleLowerCase()
        });
      }
      if (!shouldReadXmlEntry(entry.fileName, format)) continue;
      if (entry.uncompressedSize > limits.maxXmlEntryBytes) {
        throw new PigeDomainError(`parser.${format}.xml_part_too_large`, `An XML part in the ${format.toUpperCase()} package exceeds the parser limit.`);
      }
      selectedXmlBytes += entry.uncompressedSize;
      if (selectedXmlBytes > limits.maxSelectedXmlBytes) {
        throw new PigeDomainError(`parser.${format}.selected_xml_too_large`, `Selected XML parts in the ${format.toUpperCase()} package exceed the parser limit.`);
      }
      const xml = await readEntryText(zipFile, entry, limits.maxXmlEntryBytes, format);
      if (/<!DOCTYPE/iu.test(xml)) {
        throw new PigeDomainError(`parser.${format}.doctype_not_allowed`, `DOCTYPE declarations are not allowed in ${format.toUpperCase()} parser input.`);
      }
      selected.set(entry.fileName, xml);
    }

    validateRequiredParts(entryNames, format);
    return {
      entries: selected,
      entryNames,
      entryCount,
      totalUncompressedBytes,
      mediaReferences
    };
  } finally {
    zipFile.close();
  }
}

function validateArchiveEntry(entry: Entry, format: "docx" | "pptx", limits: OfficeParserLimits): void {
  const invalidName = validateFileName(entry.fileName);
  if (
    invalidName ||
    entry.fileName.length > MAX_ENTRY_NAME_LENGTH ||
    entry.fileName.includes("\\") ||
    entry.fileName.startsWith("/")
  ) {
    throw new PigeDomainError(`parser.${format}.unsafe_entry`, `The ${format.toUpperCase()} package contains an unsafe part path.`);
  }
  if (
    !Number.isSafeInteger(entry.compressedSize) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.compressedSize < 0 ||
    entry.uncompressedSize < 0
  ) {
    throw new PigeDomainError(`parser.${format}.invalid_entry_size`, `The ${format.toUpperCase()} package contains an invalid part size.`);
  }
  if (entry.isEncrypted()) {
    throw new PigeDomainError(`parser.${format}.encrypted`, `Encrypted ${format.toUpperCase()} packages are not supported.`);
  }
  if (!entry.canDecodeFileData()) {
    throw new PigeDomainError(`parser.${format}.unsupported_compression`, `The ${format.toUpperCase()} package uses an unsupported compression method.`);
  }
  if (entry.uncompressedSize > limits.maxUncompressedBytes) {
    throw new PigeDomainError(`parser.${format}.entry_too_large`, `A part in the ${format.toUpperCase()} package exceeds the parser limit.`);
  }
  if (
    entry.uncompressedSize >= COMPRESSION_RATIO_MIN_BYTES &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO
  ) {
    throw new PigeDomainError(`parser.${format}.suspicious_compression`, `The ${format.toUpperCase()} package has a suspicious compression ratio.`);
  }
}

function shouldReadXmlEntry(fileName: string, format: "docx" | "pptx"): boolean {
  if (fileName === "docProps/core.xml" || fileName === "[Content_Types].xml") return true;
  if (format === "docx") return fileName.endsWith(".xml") || fileName.endsWith(".rels");
  return fileName === "ppt/presentation.xml" ||
    fileName === "ppt/_rels/presentation.xml.rels" ||
    /^ppt\/slides\/slide\d+\.xml$/u.test(fileName) ||
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/u.test(fileName) ||
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/u.test(fileName);
}

function isMediaEntry(fileName: string, format: "docx" | "pptx"): boolean {
  return format === "docx" ? fileName.startsWith("word/media/") : fileName.startsWith("ppt/media/");
}

function validateRequiredParts(entryNames: ReadonlySet<string>, format: "docx" | "pptx"): void {
  const required = format === "docx"
    ? ["[Content_Types].xml", "word/document.xml"]
    : ["[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"];
  if (required.some((part) => !entryNames.has(part))) {
    throw new PigeDomainError(`parser.${format}.required_part_missing`, `The ${format.toUpperCase()} package is missing a required OpenXML part.`);
  }
}

async function readEntryText(
  zipFile: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
  maxBytes: number,
  format: "docx" | "pptx"
): Promise<string> {
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new PigeDomainError(`parser.${format}.xml_part_too_large`, `An XML part in the ${format.toUpperCase()} package exceeds the parser limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}
