import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { Document, isSeq, parseDocument } from "yaml";
import {
  PigeMarkdownLegacyFrontmatterSchema,
  PigeMarkdownFrontmatterSchema,
  type PigeMarkdownFrontmatter
} from "@pige/schemas";

export const PIGE_MANAGED_BLOCK_START = "<!-- pige:managed:start";
export const PIGE_MANAGED_BLOCK_END = "<!-- pige:managed:end -->";

export interface MarkdownCitationRef {
  readonly sourceId: string;
  readonly locator?: string;
}

export interface PigeFrontmatter {
  readonly id?: string;
  readonly schema_version?: number;
  readonly title?: string;
  readonly type?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly status?: string;
  readonly language?: string;
  readonly aliases?: readonly string[];
  readonly tags?: readonly string[];
  readonly topics?: readonly string[];
  readonly entities?: readonly string[];
  readonly source_ids?: readonly string[];
  readonly related_page_ids?: readonly string[];
}

export interface PigeFrontmatterParseResult {
  readonly frontmatter: PigeFrontmatter;
  readonly raw: string;
  readonly bodyStartOffset: number;
}

export interface PigeMarkdownPageParseResult {
  readonly frontmatter: PigeMarkdownFrontmatter;
  readonly raw: string;
  readonly bodyStartOffset: number;
  readonly markdownBody: string;
}

export interface PigeMarkdownRenderResult {
  readonly html: string;
  readonly markdownBody: string;
  readonly selectionSegments: readonly PigeMarkdownSelectionSegment[];
}

export interface PigeMarkdownSelectionSegment {
  readonly segmentId: string;
  readonly text: string;
  readonly sourceStartOffset: number;
  readonly sourceEndOffset: number;
}

export interface PigeMarkdownLinkRef {
  readonly kind: "wiki_link" | "markdown_link";
  readonly target: string;
  readonly label: string;
}

interface PigeHastNode {
  type: string;
  value?: string;
  position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: PigeHastNode[];
}

interface PreparedMarkdown {
  readonly markdown: string;
  readonly originalOffsetAtBoundary: readonly number[];
}

export function createCitationLabel(ref: MarkdownCitationRef): string {
  return ref.locator ? `${ref.sourceId}@${ref.locator}` : ref.sourceId;
}

export async function renderPigeMarkdownToHtml(markdown: string): Promise<PigeMarkdownRenderResult> {
  const markdownBody = stripPigeFrontmatter(markdown);
  const prepared = preparePigeInlineReferences(markdownBody);
  const selectionSegments: PigeMarkdownSelectionSegment[] = [];
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypePigeSelectionSegments, {
      markdownBody,
      originalOffsetAtBoundary: prepared.originalOffsetAtBoundary,
      selectionSegments
    })
    .use(rehypePigeReaderResourcePolicy)
    .use(rehypeSanitize, {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        a: [
          ...(defaultSchema.attributes?.a ?? []),
          ["className", "pige-wikilink", "pige-source-citation"],
          ["dataPigeRef"]
        ],
        code: [
          ...(defaultSchema.attributes?.code ?? []),
          ["className"]
        ],
        span: [
          ...(defaultSchema.attributes?.span ?? []),
          ["dataPigeSelectionSegment", /^readerseg_[a-f0-9]{16}$/u]
        ]
      }
    })
    .use(rehypeStringify)
    .process(prepared.markdown);

  return {
    html: String(rendered),
    markdownBody,
    selectionSegments
  };
}

function rehypePigeSelectionSegments(options: {
  readonly markdownBody: string;
  readonly originalOffsetAtBoundary: readonly number[];
  readonly selectionSegments: PigeMarkdownSelectionSegment[];
}): (tree: unknown) => void {
  return (tree: unknown): void => {
    let nextSegment = 0;
    annotateSelectableText(tree as PigeHastNode, [], options, () => {
      const id = `readerseg_${nextSegment.toString(16).padStart(16, "0")}`;
      nextSegment += 1;
      return id;
    });
  };
}

function annotateSelectableText(
  node: PigeHastNode,
  ancestors: readonly string[],
  options: {
    readonly markdownBody: string;
    readonly originalOffsetAtBoundary: readonly number[];
    readonly selectionSegments: PigeMarkdownSelectionSegment[];
  },
  createSegmentId: () => string
): void {
  const tagName = node.type === "element" ? node.tagName : undefined;
  const nextAncestors = tagName ? [...ancestors, tagName] : ancestors;
  if (node.type === "text" && !ancestors.some((tag) => tag === "code" || tag === "pre")) {
    const value = node.value;
    const preparedStart = node.position?.start?.offset;
    const preparedEnd = node.position?.end?.offset;
    if (
      value &&
      /\S/u.test(value) &&
      preparedStart !== undefined &&
      preparedEnd !== undefined &&
      preparedStart >= 0 &&
      preparedEnd > preparedStart &&
      preparedEnd < options.originalOffsetAtBoundary.length
    ) {
      const sourceStartOffset = options.originalOffsetAtBoundary[preparedStart];
      const sourceEndOffset = options.originalOffsetAtBoundary[preparedEnd];
      if (
        sourceStartOffset !== undefined &&
        sourceEndOffset !== undefined &&
        sourceEndOffset > sourceStartOffset &&
        options.markdownBody.slice(sourceStartOffset, sourceEndOffset) === value
      ) {
        const segmentId = createSegmentId();
        options.selectionSegments.push({
          segmentId,
          text: value,
          sourceStartOffset,
          sourceEndOffset
        });
        node.type = "element";
        node.tagName = "span";
        node.properties = { dataPigeSelectionSegment: segmentId };
        node.children = [{ type: "text", value }];
        delete node.value;
        delete node.position;
      }
    }
  }

  for (const child of node.children ?? []) {
    annotateSelectableText(child, nextAncestors, options, createSegmentId);
  }
}

function rehypePigeReaderResourcePolicy(): (tree: unknown) => void {
  return (tree: unknown): void => enforcePigeReaderResourcePolicy(tree as PigeHastNode);
}

function enforcePigeReaderResourcePolicy(node: PigeHastNode): void {
  if (node.type === "element" && node.properties) {
    if (node.tagName === "a") {
      const href = node.properties.href;
      if (typeof href !== "string" || !isPigeReaderInternalHref(href)) {
        delete node.properties.href;
      }
    }

    if (node.tagName === "img") {
      const src = node.properties.src;
      if (typeof src !== "string" || !isSafeRelativeReaderImageSource(src)) {
        delete node.properties.src;
      }
    }
  }

  for (const child of node.children ?? []) enforcePigeReaderResourcePolicy(child);
}

function isPigeReaderInternalHref(href: string): boolean {
  return href.startsWith("#wiki:") || href.startsWith("#source:src_");
}

function isSafeRelativeReaderImageSource(src: string): boolean {
  if (
    src.length === 0 ||
    src.length > 2048 ||
    src !== src.trim() ||
    /[\u0000-\u001f\u007f]/u.test(src)
  ) {
    return false;
  }

  const decoded = decodeReaderResourceSource(src);
  if (decoded === undefined) return false;

  if (decoded !== decoded.trim() || /[\u0000-\u001f\u007f]/u.test(decoded)) return false;

  const pathPart = decoded.split(/[?#]/u, 1)[0] ?? "";
  if (
    pathPart.length === 0 ||
    pathPart.startsWith("/") ||
    pathPart.startsWith("\\") ||
    pathPart.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(pathPart) ||
    pathPart.split("/").some((segment) => segment === "..")
  ) {
    return false;
  }

  return /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(pathPart);
}

function decodeReaderResourceSource(value: string): string | undefined {
  let decoded = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return undefined;
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return undefined;
}

export function stripPigeFrontmatter(markdown: string): string {
  const parsed = parsePigeFrontmatter(markdown);
  return parsed ? markdown.slice(parsed.bodyStartOffset).trimStart() : markdown;
}

export function parsePigeFrontmatter(markdownPrefix: string): PigeFrontmatterParseResult | undefined {
  const bomLength = markdownPrefix.startsWith("\uFEFF") ? 1 : 0;
  const normalized = markdownPrefix.slice(bomLength);
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) return undefined;

  const firstLineBreak = normalized.indexOf("\n");
  const closingMarker = findClosingFrontmatterMarker(normalized, firstLineBreak + 1);
  if (!closingMarker) return undefined;

  const raw = normalized.slice(firstLineBreak + 1, closingMarker.start);
  return {
    raw,
    frontmatter: parseKnownFrontmatterFields(raw),
    bodyStartOffset: closingMarker.end + bomLength
  };
}

export function parsePigeMarkdownPage(markdown: string): PigeMarkdownPageParseResult | undefined {
  const yaml = readPigeYamlObject(markdown);
  if (!yaml) return undefined;
  const frontmatter = PigeMarkdownFrontmatterSchema.safeParse(yaml.value);
  return frontmatter.success ? pageParseResult(markdown, yaml.parsed, frontmatter.data) : undefined;
}

export function parsePigeMarkdownIndexPage(markdown: string): PigeMarkdownPageParseResult | undefined {
  const strict = parsePigeMarkdownPage(markdown);
  if (strict) return strict;
  const yaml = readPigeYamlObject(markdown);
  if (!yaml) return undefined;
  const legacy = PigeMarkdownLegacyFrontmatterSchema.safeParse(yaml.value);
  return legacy.success
    ? pageParseResult(markdown, yaml.parsed, legacy.data as PigeMarkdownFrontmatter)
    : undefined;
}

export function rewritePigeMarkdownFrontmatter(
  markdown: string,
  patch: Readonly<Record<string, unknown>>
): string | undefined {
  const parsed = parsePigeMarkdownPage(markdown);
  if (!parsed || !isSafeYamlObject(patch)) return undefined;
  const next = PigeMarkdownFrontmatterSchema.safeParse({ ...parsed.frontmatter, ...patch });
  if (!next.success) return undefined;
  const document = new Document(next.data, { schema: "core" });
  for (const key of ["aliases", "tags", "topics"]) {
    const node = document.get(key, true);
    if (isSeq(node)) node.flow = true;
  }
  const yaml = document.toString({
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
    simpleKeys: true
  });
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : "";
  return `${bom}---\n${yaml}---\n${markdown.slice(parsed.bodyStartOffset)}`;
}

function isSafeYamlObject(value: unknown, depth = 0): value is Record<string, unknown> {
  if (depth > 24 || value === null || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor" || key === "<<") return false;
    if (!isSafeYamlChild(child, depth + 1)) return false;
  }
  return true;
}

function readPigeYamlObject(markdown: string): {
  readonly parsed: PigeFrontmatterParseResult;
  readonly value: Record<string, unknown>;
} | undefined {
  const parsed = parsePigeFrontmatter(markdown);
  if (!parsed || new TextEncoder().encode(parsed.raw).byteLength > 64 * 1024) return undefined;
  try {
    const document = parseDocument(parsed.raw, { schema: "core", strict: true, uniqueKeys: true });
    if (document.errors.length > 0 || document.warnings.length > 0 || document.contents === null ||
      !frontmatterArrayStylesAreValid(document)) return undefined;
    const value = document.toJS({ maxAliasCount: 0 }) as unknown;
    return isSafeYamlObject(value) ? { parsed, value } : undefined;
  } catch {
    return undefined;
  }
}

function frontmatterArrayStylesAreValid(document: ReturnType<typeof parseDocument>): boolean {
  return ["aliases", "tags", "topics"].every((key) => {
    const node = document.get(key, true);
    return node === undefined || (isSeq(node) && node.flow === true);
  });
}

function pageParseResult(
  markdown: string,
  parsed: PigeFrontmatterParseResult,
  frontmatter: PigeMarkdownFrontmatter
): PigeMarkdownPageParseResult {
  return {
    raw: parsed.raw,
    frontmatter,
    bodyStartOffset: parsed.bodyStartOffset,
    markdownBody: markdown.slice(parsed.bodyStartOffset)
  };
}

function isSafeYamlChild(value: unknown, depth: number): boolean {
  if (depth > 24) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1_024 && value.every((entry) => isSafeYamlChild(entry, depth + 1));
  return isSafeYamlObject(value, depth);
}

export function extractPigeMarkdownLinkRefs(markdown: string): readonly PigeMarkdownLinkRef[] {
  const markdownBody = removeCodeSpansAndBlocks(stripPigeFrontmatter(markdown));
  const refs: PigeMarkdownLinkRef[] = [];

  for (const match of markdownBody.matchAll(/\[\[([^\]\n]+)\]\]/gu)) {
    const rawTarget = match[1] ?? "";
    const [targetPart, labelPart] = rawTarget.split("|", 2);
    const target = normalizeInlineRef(targetPart ?? "");
    const label = normalizeInlineRef(labelPart ?? targetPart ?? "");
    if (target && label) refs.push({ kind: "wiki_link", target, label });
  }

  for (const match of markdownBody.matchAll(/(?<!!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const label = normalizeInlineRef(match[1] ?? "");
    const rawTarget = normalizeMarkdownLinkTarget(match[2] ?? "");
    if (label && rawTarget) refs.push({ kind: "markdown_link", target: rawTarget, label });
  }

  return refs;
}

export function extractPigeMarkdownCitationRefs(markdown: string): readonly MarkdownCitationRef[] {
  const markdownBody = removeCodeSpansAndBlocks(stripPigeFrontmatter(markdown));
  const refs: MarkdownCitationRef[] = [];
  const marker = "[source:src_";
  let cursor = 0;
  while (cursor < markdownBody.length) {
    const start = markdownBody.indexOf(marker, cursor);
    if (start < 0) break;
    const end = markdownBody.indexOf("]", start + marker.length);
    if (end < 0) break;
    const parsed = parseSourceCitation(markdownBody.slice(start + 1, end));
    if (parsed && markdownBody[end + 1] !== "(") refs.push(parsed);
    cursor = end + 1;
  }
  return refs;
}

function findClosingFrontmatterMarker(value: string, startAt: number): { start: number; end: number } | undefined {
  let cursor = startAt;
  while (cursor < value.length) {
    const lineEnd = value.indexOf("\n", cursor);
    const end = lineEnd === -1 ? value.length : lineEnd + 1;
    const line = value.slice(cursor, lineEnd === -1 ? value.length : lineEnd).replace(/\r$/u, "");
    if (line === "---") return { start: cursor, end };
    cursor = end;
  }
  return undefined;
}

function parseKnownFrontmatterFields(raw: string): PigeFrontmatter {
  const parsed: Partial<Record<keyof PigeFrontmatter, string | number | readonly string[]>> = {};
  for (const line of raw.split(/\r?\n/u)) {
    if (!line || /^\s/u.test(line)) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim() as keyof PigeFrontmatter;
    if (!isKnownFrontmatterKey(key)) continue;
    const value = parseInlineYamlValue(line.slice(separatorIndex + 1).trim());
    if (key === "schema_version" && typeof value === "number") {
      parsed[key] = value;
    } else if (isKnownFrontmatterArrayKey(key) && isStringArray(value)) {
      parsed[key] = value;
    } else if (key !== "schema_version" && !isKnownFrontmatterArrayKey(key) && typeof value === "string") {
      parsed[key] = value;
    }
  }

  return parsed as PigeFrontmatter;
}

function isKnownFrontmatterArrayKey(key: keyof PigeFrontmatter): key is "aliases" | "tags" | "topics" | "entities" | "source_ids" | "related_page_ids" {
  return ["aliases", "tags", "topics", "entities", "source_ids", "related_page_ids"].includes(key);
}

function isKnownFrontmatterKey(key: string): key is keyof PigeFrontmatter {
  return [
    "id",
    "schema_version",
    "title",
    "type",
    "created_at",
    "updated_at",
    "status",
    "language",
    "aliases",
    "tags",
    "topics",
    "entities",
    "source_ids",
    "related_page_ids"
  ].includes(key);
}

export function normalizePigeTag(value: string): string | undefined {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 48 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function createPigeTagKey(value: string): string | undefined {
  return normalizePigeTag(value)?.toLocaleLowerCase("en-US");
}

export function normalizePigeTags(values: readonly string[], maximum = 12): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const tag = normalizePigeTag(value);
    const key = tag ? createPigeTagKey(tag) : undefined;
    if (!tag || !key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

function parseInlineYamlValue(value: string): string | number | readonly string[] | undefined {
  if (value.length === 0) return "";

  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isStringArray(parsed) ? parsed : undefined;
    } catch {
      return parseSimpleStringArray(value);
    }
  }

  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }

  if (/^-?\d+$/u.test(value)) return Number.parseInt(value, 10);
  return value;
}

function parseSimpleStringArray(value: string): readonly string[] | undefined {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  const values = inner.split(",").map((item) => item.trim().replace(/^["']|["']$/gu, ""));
  return values.every((item) => item.length > 0) ? values : undefined;
}

function removeCodeSpansAndBlocks(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]*`/gu, " ");
}

function normalizeMarkdownLinkTarget(value: string): string {
  const decoded = safeDecodeURIComponent(value.trim());
  if (!decoded || /^[a-z][a-z0-9+.-]*:/iu.test(decoded)) return "";
  if (decoded.startsWith("#wiki:")) return normalizeInlineRef(decoded.slice("#wiki:".length));
  if (decoded.startsWith("#")) return "";
  const [pathPart, anchorPart] = decoded.split("#", 2);
  if (!pathPart?.endsWith(".md")) return "";
  const normalizedPath = pathPart.replace(/\\/gu, "/").replace(/^\.?\//u, "");
  return anchorPart ? `${normalizedPath}#${anchorPart}` : normalizedPath;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function preparePigeInlineReferences(markdown: string): PreparedMarkdown {
  const identityMap = Array.from({ length: markdown.length + 1 }, (_value, index) => index);
  const wikiPrepared = replaceMappedMarkdown(
    { markdown, originalOffsetAtBoundary: identityMap },
    findWikiReplacements(markdown)
  );
  return replaceMappedMarkdown(
    wikiPrepared,
    findSourceCitationReplacements(wikiPrepared.markdown)
  );
}

interface MappedReplacement {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

function findWikiReplacements(markdown: string): MappedReplacement[] {
  const replacements: MappedReplacement[] = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf("[[", cursor);
    if (start < 0) break;
    let delimiter = start + 2;
    while (
      delimiter < markdown.length &&
      markdown[delimiter] !== "]" &&
      markdown[delimiter] !== "\n" &&
      markdown[delimiter] !== "\r"
    ) {
      delimiter += 1;
    }
    if (
      delimiter > start + 2 &&
      markdown[delimiter] === "]" &&
      markdown[delimiter + 1] === "]"
    ) {
      const rawTarget = markdown.slice(start + 2, delimiter);
      const [targetPart, labelPart] = rawTarget.split("|", 2);
      const target = normalizeInlineRef(targetPart ?? "");
      const label = normalizeInlineRef(labelPart ?? targetPart ?? "");
      if (target && label) {
        replacements.push({
          start,
          end: delimiter + 2,
          replacement: `[${escapeMarkdownLinkText(label)}](#wiki:${encodeURIComponent(target)})`
        });
      }
      cursor = delimiter + 2;
      continue;
    }
    if (delimiter >= markdown.length) break;
    cursor = delimiter + 1;
  }
  return replacements;
}

function findSourceCitationReplacements(markdown: string): MappedReplacement[] {
  const replacements: MappedReplacement[] = [];
  const marker = "[source:src_";
  let cursor = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf(marker, cursor);
    if (start < 0) break;
    let end = start + marker.length;
    while (end < markdown.length && markdown[end] !== "]" && !isInlineWhitespace(markdown[end])) {
      end += 1;
    }
    if (markdown[end] === "]" && markdown[end + 1] !== "(") {
      const citation = markdown.slice(start + 1, end);
      if (isSourceCitation(citation)) {
        replacements.push({
          start,
          end: end + 1,
          replacement: `[${escapeMarkdownLinkText(citation)}](#${citation})`
        });
      }
    }
    cursor = end < markdown.length ? end + 1 : markdown.length;
  }
  return replacements;
}

function parseSourceCitation(value: string): MarkdownCitationRef | undefined {
  const prefix = "source:src_";
  if (!value.startsWith(prefix)) return undefined;
  let cursor = prefix.length;
  for (let index = 0; index < 8; index += 1) {
    if (!isAsciiDigit(value[cursor + index])) return undefined;
  }
  cursor += 8;
  if (value[cursor] !== "_") return undefined;
  cursor += 1;
  const idStart = cursor;
  while (isLowerAsciiAlphanumeric(value[cursor])) cursor += 1;
  if (cursor - idStart < 8) return undefined;
  const sourceId = value.slice("source:".length, cursor);
  if (cursor === value.length) return { sourceId };
  if (value[cursor] !== "#" || cursor + 1 >= value.length) return undefined;
  const locator = value.slice(cursor + 1);
  return Array.from(locator).some(isInlineWhitespace) ? undefined : { sourceId, locator };
}

function isSourceCitation(value: string): boolean {
  return parseSourceCitation(value) !== undefined;
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function isLowerAsciiAlphanumeric(value: string | undefined): boolean {
  return value !== undefined && (
    (value >= "a" && value <= "z") ||
    (value >= "0" && value <= "9")
  );
}

function isInlineWhitespace(value: string | undefined): boolean {
  return value !== undefined && value.trim() === "";
}

function replaceMappedMarkdown(
  input: PreparedMarkdown,
  replacements: readonly MappedReplacement[]
): PreparedMarkdown {
  let cursor = 0;
  let markdown = "";
  const originalOffsetAtBoundary: number[] = [input.originalOffsetAtBoundary[0] ?? 0];
  for (const { start, end, replacement } of replacements) {
    appendMappedSlice(start);
    const originalStart = input.originalOffsetAtBoundary[start] ?? 0;
    const originalEnd = input.originalOffsetAtBoundary[end] ?? originalStart;
    markdown += replacement;
    for (let index = 1; index <= replacement.length; index += 1) {
      originalOffsetAtBoundary.push(index === replacement.length ? originalEnd : originalStart);
    }
    cursor = end;
  }
  appendMappedSlice(input.markdown.length);
  return { markdown, originalOffsetAtBoundary };

  function appendMappedSlice(end: number): void {
    markdown += input.markdown.slice(cursor, end);
    for (let index = cursor + 1; index <= end; index += 1) {
      originalOffsetAtBoundary.push(input.originalOffsetAtBoundary[index] ?? 0);
    }
  }
}

function normalizeInlineRef(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\\]])/gu, "\\$1");
}
