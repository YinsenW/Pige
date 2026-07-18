import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

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
  readonly source_ids?: readonly string[];
}

export interface PigeFrontmatterParseResult {
  readonly frontmatter: PigeFrontmatter;
  readonly raw: string;
  readonly bodyStartOffset: number;
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
  const normalized = markdownPrefix.replace(/^\uFEFF/u, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) return undefined;

  const firstLineBreak = normalized.indexOf("\n");
  const closingMarker = findClosingFrontmatterMarker(normalized, firstLineBreak + 1);
  if (!closingMarker) return undefined;

  const raw = normalized.slice(firstLineBreak + 1, closingMarker.start);
  return {
    raw,
    frontmatter: parseKnownFrontmatterFields(raw),
    bodyStartOffset: closingMarker.end
  };
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

function isKnownFrontmatterArrayKey(key: keyof PigeFrontmatter): key is "aliases" | "tags" | "topics" | "source_ids" {
  return ["aliases", "tags", "topics", "source_ids"].includes(key);
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
    "source_ids"
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
    /\[\[([^\]\n]+)\]\]/gu,
    (_match, rawTarget: string) => {
      const [targetPart, labelPart] = rawTarget.split("|", 2);
      const target = normalizeInlineRef(targetPart ?? "");
      const label = normalizeInlineRef(labelPart ?? targetPart ?? "");
      if (!target || !label) return `[[${rawTarget}]]`;
      return `[${escapeMarkdownLinkText(label)}](#wiki:${encodeURIComponent(target)})`;
    }
  );
  return replaceMappedMarkdown(
    wikiPrepared,
    /\[(source:src_\d{8}_[a-z0-9]{8,}(?:#[^\]\s]+)?)\](?!\()/gu,
    (_match, citation: string) => {
      return `[${escapeMarkdownLinkText(citation)}](#${citation})`;
    }
  );
}

function replaceMappedMarkdown(
  input: PreparedMarkdown,
  pattern: RegExp,
  replace: (match: string, capture: string) => string
): PreparedMarkdown {
  let cursor = 0;
  let markdown = "";
  const originalOffsetAtBoundary: number[] = [input.originalOffsetAtBoundary[0] ?? 0];
  for (const match of input.markdown.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    appendMappedSlice(start);
    const replacement = replace(match[0], match[1] ?? "");
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
