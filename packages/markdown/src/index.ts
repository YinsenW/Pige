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
}

export interface PigeMarkdownLinkRef {
  readonly kind: "wiki_link" | "markdown_link";
  readonly target: string;
  readonly label: string;
}

export function createCitationLabel(ref: MarkdownCitationRef): string {
  return ref.locator ? `${ref.sourceId}@${ref.locator}` : ref.sourceId;
}

export async function renderPigeMarkdownToHtml(markdown: string): Promise<PigeMarkdownRenderResult> {
  const markdownBody = stripPigeFrontmatter(markdown);
  const preparedMarkdown = preparePigeInlineReferences(markdownBody);
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkRehype)
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
        ]
      }
    })
    .use(rehypeStringify)
    .process(preparedMarkdown);

  return {
    html: String(rendered),
    markdownBody
  };
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
    if (typeof value === "string" || typeof value === "number" || isStringArray(value)) {
      parsed[key] = value;
    }
  }

  return parsed as PigeFrontmatter;
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
    "topics",
    "source_ids"
  ].includes(key);
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

function preparePigeInlineReferences(markdown: string): string {
  return markdown
    .replace(/\[\[([^\]\n]+)\]\]/gu, (_match, rawTarget: string) => {
      const [targetPart, labelPart] = rawTarget.split("|", 2);
      const target = normalizeInlineRef(targetPart ?? "");
      const label = normalizeInlineRef(labelPart ?? targetPart ?? "");
      if (!target || !label) return `[[${rawTarget}]]`;
      return `[${escapeMarkdownLinkText(label)}](#wiki:${encodeURIComponent(target)})`;
    })
    .replace(/\[(source:src_\d{8}_[a-z0-9]{8,}(?:#[^\]\s]+)?)\](?!\()/gu, (_match, citation: string) => {
      return `[${escapeMarkdownLinkText(citation)}](#${citation})`;
    });
}

function normalizeInlineRef(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\\]])/gu, "\\$1");
}
