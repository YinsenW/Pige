import fs from "node:fs";
import { toDocument, toMarkdownBytes, type Document } from "@firecrawl/anydoc";
import { PigeDomainError } from "@pige/domain";

export const ANYDOC_PARSER_ID = "anydoc@0.1.7";
export const ANYDOC_PARSER_ENGINE = "anydoc";
export const ANYDOC_PARSER_VERSION = "0.1.7";

export type AnyDocFormat = "docx" | "pptx" | "pdf";

const SENSITIVE_QUERY_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|credential|key|password|secret|signature|sig|token)(?:$|[_-])/iu;
const HTTP_URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/giu;

export interface AnyDocConversion {
  readonly markdown: string;
  readonly document?: Document;
}

/**
 * Converts only bytes read from Pige's already-verified private snapshot. It
 * intentionally does not call AnyDoc's path or CLI APIs.
 */
export async function convertAnyDocSnapshot(
  filePath: string,
  format: AnyDocFormat,
  maxBytes: number,
  options: { readonly includeDocument?: boolean } = {}
): Promise<AnyDocConversion> {
  const bytes = await readBoundedSnapshot(filePath, format, maxBytes);
  try {
    const nativeFormat = toNativeFormat(format);
    const [markdown, document] = await Promise.all([
      toMarkdownBytes(bytes, nativeFormat),
      options.includeDocument ? toDocument(bytes, nativeFormat) : Promise.resolve(undefined)
    ]);
    return {
      markdown: sanitizeMarkdown(markdown),
      ...(document ? { document } : {})
    };
  } catch (caught) {
    throw mapAnyDocError(format, caught);
  }
}

export function limitConvertedMarkdown(markdown: string, maxCharacters: number): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const normalized = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (normalized.length <= maxCharacters) return { text: normalized, truncated: false };
  return { text: normalized.slice(0, maxCharacters).trimEnd(), truncated: true };
}

function toNativeFormat(format: AnyDocFormat): Parameters<typeof toMarkdownBytes>[1] {
  return format as Parameters<typeof toMarkdownBytes>[1];
}

async function readBoundedSnapshot(filePath: string, format: AnyDocFormat, maxBytes: number): Promise<Uint8Array> {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(filePath, flags);
  } catch {
    throw sourceError(format);
  }
  try {
    const before = await file.stat();
    if (!before.isFile()) throw sourceError(format);
    if (before.size > maxBytes) {
      throw new PigeDomainError(`parser.${format}.file_too_large`, `The ${format.toUpperCase()} exceeds the configured local parser size limit.`);
    }
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await file.read(bytes, position, before.size - position, position);
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    const after = await file.stat();
    if (
      position !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new PigeDomainError(`parser.${format}.source_changed`, `The preserved ${format.toUpperCase()} changed while it was being read.`);
    }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await file.close();
  }
}

export function mapAnyDocError(format: AnyDocFormat, caught: unknown): PigeDomainError {
  if (caught instanceof PigeDomainError) return caught;
  const code = readConvertErrorCode(caught);
  switch (code) {
    case "unsupported":
      return new PigeDomainError(`parser.${format}.unsupported`, `The preserved ${format.toUpperCase()} format is not supported for local conversion.`);
    case "malformed":
      return new PigeDomainError(`parser.${format}.invalid`, `The preserved ${format.toUpperCase()} is not valid readable input.`);
    case "encrypted":
      return new PigeDomainError(
        format === "pdf" ? "parser.pdf.password_required" : `parser.${format}.encrypted`,
        `The preserved ${format.toUpperCase()} is encrypted and cannot be converted locally.`
      );
    case "resourceLimit":
      return new PigeDomainError(`parser.${format}.resource_limit`, `The preserved ${format.toUpperCase()} exceeds a local conversion safety limit.`);
    case "missingPart":
      return new PigeDomainError(`parser.${format}.required_part_missing`, `The preserved ${format.toUpperCase()} is missing a required document part.`);
    case "io":
      return sourceError(format);
    default:
      return new PigeDomainError(`parser.${format}.failed`, `${format.toUpperCase()} local conversion failed.`);
  }
}

function readConvertErrorCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  const code = value.code;
  return typeof code === "string" ? code : undefined;
}

function sourceError(format: AnyDocFormat): PigeDomainError {
  return new PigeDomainError(`parser.${format}.source_missing`, `The preserved ${format.toUpperCase()} source is unavailable.`);
}

function sanitizeMarkdown(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(HTTP_URL_PATTERN, (candidate) => redactUrl(candidate))
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function redactUrl(candidate: string): string {
  try {
    const parsed = new URL(candidate);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return candidate;
  }
}
