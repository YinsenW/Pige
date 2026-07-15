import { createHash } from "node:crypto";
import type { MarkdownPageType } from "@pige/schemas";
import { sanitizeSearchBody } from "./search-text-utils";

export const RAG_CHUNKER_VERSION = "pige-markdown-v1";
export const RAG_CHUNK_MAX_CHARACTERS = 1_200;
export const RAG_CHUNK_OVERLAP_CHARACTERS = 120;

export interface RagChunkMetadata {
  readonly chunkId: string;
  readonly ownerId: string;
  readonly ownerType: "page";
  readonly pagePath: string;
  readonly pageType: MarkdownPageType;
  readonly sourceIds: readonly string[];
  readonly headingPath: readonly string[];
  readonly characterStart: number;
  readonly characterEnd: number;
  readonly textHash: `sha256:${string}`;
  readonly tokenCount: number;
  readonly chunkerVersion: typeof RAG_CHUNKER_VERSION;
}

export interface CreateMarkdownRagChunksInput {
  readonly pageId: string;
  readonly pagePath: string;
  readonly pageType: MarkdownPageType;
  readonly sourceIds: readonly string[];
  readonly body: string;
}

interface MarkdownSection {
  readonly headingPath: readonly string[];
  readonly start: number;
  readonly end: number;
}

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
const MIN_PREFERRED_BOUNDARY = Math.floor(RAG_CHUNK_MAX_CHARACTERS * 0.55);

export function createMarkdownRagChunks(input: CreateMarkdownRagChunksInput): readonly RagChunkMetadata[] {
  const sourceIds = Array.from(new Set(input.sourceIds)).sort();
  const chunks: RagChunkMetadata[] = [];

  for (const section of splitMarkdownSections(input.body)) {
    for (const range of splitSectionRanges(input.body, section)) {
      const text = input.body.slice(range.start, range.end);
      const safeText = sanitizeSearchBody(text);
      if (!safeText.trim()) continue;
      const textHash = sha256(safeText);
      chunks.push({
        chunkId: createChunkId(input.pageId, section.headingPath, range.start, range.end, textHash),
        ownerId: input.pageId,
        ownerType: "page",
        pagePath: input.pagePath,
        pageType: input.pageType,
        sourceIds,
        headingPath: section.headingPath,
        characterStart: range.start,
        characterEnd: range.end,
        textHash,
        tokenCount: estimateTokenCount(safeText),
        chunkerVersion: RAG_CHUNKER_VERSION
      });
    }
  }

  return chunks;
}

function splitMarkdownSections(body: string): readonly MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const headingPath: string[] = [];
  let sectionStart = 0;
  let sectionHeadingPath: readonly string[] = [];
  let cursor = 0;

  for (const line of body.match(/.*(?:\r?\n|$)/gu) ?? []) {
    if (!line) continue;
    const lineBody = line.replace(/\r?\n$/u, "");
    const match = HEADING_PATTERN.exec(lineBody);
    if (match) {
      appendTrimmedSection(sections, body, sectionStart, cursor, sectionHeadingPath);
      const depth = match[1]?.length ?? 1;
      const title = normalizeHeading(match[2] ?? "");
      headingPath.splice(Math.max(0, depth - 1));
      if (title) headingPath[depth - 1] = title;
      sectionHeadingPath = headingPath.filter(Boolean);
      sectionStart = cursor + line.length;
    }
    cursor += line.length;
  }

  appendTrimmedSection(sections, body, sectionStart, body.length, sectionHeadingPath);
  return sections;
}

function appendTrimmedSection(
  sections: MarkdownSection[],
  body: string,
  rawStart: number,
  rawEnd: number,
  headingPath: readonly string[]
): void {
  let start = rawStart;
  let end = rawEnd;
  while (start < end && /\s/u.test(body[start] ?? "")) start += 1;
  while (end > start && /\s/u.test(body[end - 1] ?? "")) end -= 1;
  if (end <= start) return;
  sections.push({ headingPath: [...headingPath], start, end });
}

function splitSectionRanges(
  body: string,
  section: MarkdownSection
): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = section.start;

  while (start < section.end) {
    const hardEnd = Math.min(section.end, start + RAG_CHUNK_MAX_CHARACTERS);
    const end = hardEnd === section.end
      ? hardEnd
      : findPreferredBoundary(body, start, hardEnd);
    const safeEnd = avoidSplitSurrogatePair(body, Math.max(start + 1, end));
    ranges.push({ start, end: safeEnd });
    if (safeEnd >= section.end) break;

    let nextStart = Math.max(start + 1, safeEnd - RAG_CHUNK_OVERLAP_CHARACTERS);
    nextStart = avoidStartSplitSurrogatePair(body, nextStart);
    nextStart = advancePastWhitespace(body, nextStart, safeEnd);
    start = Math.min(nextStart, safeEnd);
  }

  return ranges;
}

function findPreferredBoundary(body: string, start: number, hardEnd: number): number {
  const minimum = start + MIN_PREFERRED_BOUNDARY;
  const window = body.slice(minimum, hardEnd);
  for (const marker of ["\n\n", "\n", ". ", " "]) {
    const index = window.lastIndexOf(marker);
    if (index >= 0) return minimum + index + marker.length;
  }
  return hardEnd;
}

function advancePastWhitespace(body: string, start: number, ceiling: number): number {
  let cursor = start;
  while (cursor < ceiling && /\s/u.test(body[cursor] ?? "")) cursor += 1;
  return cursor;
}

function avoidSplitSurrogatePair(body: string, end: number): number {
  if (end <= 0 || end >= body.length) return end;
  const previous = body.charCodeAt(end - 1);
  const next = body.charCodeAt(end);
  return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    ? end - 1
    : end;
}

function avoidStartSplitSurrogatePair(body: string, start: number): number {
  if (start <= 0 || start >= body.length) return start;
  const previous = body.charCodeAt(start - 1);
  const current = body.charCodeAt(start);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff
    ? start + 1
    : start;
}

function normalizeHeading(value: string): string {
  return sanitizeSearchBody(value).replace(/\s+/gu, " ").trim().slice(0, 256);
}

function estimateTokenCount(text: string): number {
  const tokens = text.match(
    /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|[\p{Letter}\p{Number}_'-]+|[^\s]/gu
  );
  return Math.max(1, tokens?.length ?? 0);
}

function createChunkId(
  pageId: string,
  headingPath: readonly string[],
  start: number,
  end: number,
  textHash: string
): string {
  const digest = createHash("sha256")
    .update(`${RAG_CHUNKER_VERSION}\0${pageId}\0${JSON.stringify(headingPath)}\0${start}\0${end}\0${textHash}`)
    .digest("hex");
  return `chunk_${digest.slice(0, 32)}`;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
