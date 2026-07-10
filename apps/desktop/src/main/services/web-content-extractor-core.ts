import { PigeDomainError } from "@pige/domain";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import {
  WEB_EXTRACTOR_ENGINE,
  WEB_EXTRACTOR_ID,
  WEB_EXTRACTOR_VERSION,
  type WebExtractionResult,
  type WebExtractorRequest
} from "./web-content-extractor-types";

const MIN_READABLE_CHARACTERS = 32;
const PROMPT_INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?previous|system\s+prompt|reveal\s+(?:the\s+)?(?:api\s+key|secret)|override\s+(?:the\s+)?instructions)/iu;
const SENSITIVE_QUERY_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|credential|key|password|secret|signature|sig|token)(?:$|[_-])/iu;
const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION", "FIGURE",
  "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL",
  "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
]);

export function extractWebContent(request: WebExtractorRequest): WebExtractionResult {
  if (request.html.length > request.limits.maxInputCharacters) {
    throw new PigeDomainError("web_extractor.input_too_large", "The fetched HTML exceeds the web extractor input limit.");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    throw new PigeDomainError("web_extractor.invalid_url", "The web extractor requires a valid page URL.");
  }

  let dom: JSDOM;
  try {
    dom = new JSDOM(request.html, {
      url: parsedUrl.toString(),
      contentType: "text/html",
      includeNodeLocations: false,
      pretendToBeVisual: false
    });
  } catch {
    throw new PigeDomainError("web_extractor.invalid_html", "The fetched page could not be parsed as inert HTML.");
  }

  try {
    const sourceDocument = dom.window.document;
    const elementCount = sourceDocument.getElementsByTagName("*").length;
    const warnings: string[] = [];
    let extractionDocument = sourceDocument.cloneNode(true) as Document;
    let article: ReturnType<Readability["parse"]> = null;
    if (elementCount <= request.limits.maxElements) {
      try {
        article = new Readability(extractionDocument, {
          maxElemsToParse: request.limits.maxElements,
          nbTopCandidates: 5,
          charThreshold: 80,
          keepClasses: false,
          disableJSONLD: false
        }).parse();
      } catch {
        warnings.push("readability_failed");
      }
    } else {
      warnings.push("element_limit_exceeded");
    }

    const readableText = normalizeText(article?.textContent ?? "");
    const usesReadability = readableText.length >= MIN_READABLE_CHARACTERS;
    if (!usesReadability) {
      warnings.push(article ? "readability_text_too_thin" : "readability_no_article");
      extractionDocument = sourceDocument.cloneNode(true) as Document;
    }
    const fallbackRoot = usesReadability ? extractionDocument.body : prepareFallbackRoot(extractionDocument);
    const unboundedText = usesReadability ? readableText : structuredText(fallbackRoot);
    const truncated = unboundedText.length > request.limits.maxOutputCharacters;
    const text = (truncated ? unboundedText.slice(0, request.limits.maxOutputCharacters) : unboundedText).trimEnd();
    if (truncated) warnings.push("extracted_text_truncated");
    if (!text) warnings.push("empty_extracted_text");
    if (PROMPT_INJECTION_PATTERN.test(text)) warnings.push("instruction_like_source_text");

    const canonicalUrl = extractCanonicalUrl(sourceDocument, parsedUrl);
    const title = normalizeMetadata(article?.title) ?? normalizeMetadata(openGraphValue(sourceDocument, "og:title")) ?? normalizeMetadata(sourceDocument.title);
    const byline = normalizeMetadata(article?.byline) ?? normalizeMetadata(metaValue(sourceDocument, "author"));
    const siteName = normalizeMetadata(article?.siteName) ?? normalizeMetadata(openGraphValue(sourceDocument, "og:site_name"));
    const language = normalizeLanguage(article?.lang) ?? normalizeLanguage(sourceDocument.documentElement.lang);
    const publishedTime = normalizeMetadata(article?.publishedTime) ?? normalizeMetadata(openGraphValue(sourceDocument, "article:published_time"));
    const excerpt = normalizeExcerpt(article?.excerpt) ?? normalizeExcerpt(metaValue(sourceDocument, "description"));
    const imageDocument = sourceDocument.cloneNode(true) as Document;
    const imageReferences = extractImageReferences(
      prepareFallbackRoot(imageDocument),
      parsedUrl,
      request.limits.maxImageReferences
    );

    return {
      parserId: WEB_EXTRACTOR_ID,
      engine: WEB_EXTRACTOR_ENGINE,
      engineVersion: WEB_EXTRACTOR_VERSION,
      mode: usesReadability ? "readability" : "dom_fallback",
      ...(title ? { title } : {}),
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(byline ? { byline } : {}),
      ...(siteName ? { siteName } : {}),
      ...(language ? { language } : {}),
      ...(publishedTime ? { publishedTime } : {}),
      ...(excerpt ? { excerpt } : {}),
      text,
      textCharacterCount: text.length,
      elementCount,
      truncated,
      imageReferences,
      warnings: uniqueWarnings(warnings)
    };
  } finally {
    dom.window.close();
  }
}

function prepareFallbackRoot(document: Document): Element {
  for (const selector of ["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed", "[hidden]", '[aria-hidden="true"]']) {
    for (const node of document.querySelectorAll(selector)) node.remove();
  }
  return document.querySelector("article, main, [role=main]") ?? document.body ?? document.documentElement;
}

function structuredText(root: Element): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.tagName === "BR") parts.push("\n");
    const block = BLOCK_ELEMENTS.has(element.tagName);
    if (block) parts.push("\n");
    for (const child of element.childNodes) visit(child);
    if (block) parts.push("\n");
  };
  visit(root);
  return normalizeText(parts.join(""));
}

function normalizeText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function extractCanonicalUrl(document: Document, baseUrl: URL): string | undefined {
  const link = Array.from(document.querySelectorAll("link[rel][href]")).find((candidate) =>
    (candidate.getAttribute("rel") ?? "").split(/\s+/u).some((value) => value.toLocaleLowerCase() === "canonical")
  );
  return normalizeHttpUrl(link?.getAttribute("href"), baseUrl);
}

function extractImageReferences(root: Element, baseUrl: URL, maxReferences: number): string[] {
  const references: string[] = [];
  const seen = new Set<string>();
  for (const image of root.querySelectorAll("img[src], source[src]")) {
    const normalized = normalizeHttpUrl(image.getAttribute("src"), baseUrl);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    references.push(normalized);
    if (references.length >= maxReferences) break;
  }
  return references;
}

function normalizeHttpUrl(value: string | null | undefined, baseUrl: URL): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString().slice(0, 2_000);
  } catch {
    return undefined;
  }
}

function metaValue(document: Document, name: string): string | undefined {
  return Array.from(document.querySelectorAll("meta[name][content]")).find((meta) =>
    (meta.getAttribute("name") ?? "").toLocaleLowerCase() === name
  )?.getAttribute("content") ?? undefined;
}

function openGraphValue(document: Document, property: string): string | undefined {
  return Array.from(document.querySelectorAll("meta[property][content]")).find((meta) =>
    (meta.getAttribute("property") ?? "").toLocaleLowerCase() === property
  )?.getAttribute("content") ?? undefined;
}

function normalizeMetadata(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function normalizeExcerpt(value: string | null | undefined): string | undefined {
  const normalized = normalizeMetadata(value);
  return normalized?.slice(0, 500);
}

function normalizeLanguage(value: string | null | undefined): string | undefined {
  const normalized = (value ?? "").trim().replaceAll("_", "-");
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(normalized) ? normalized.slice(0, 35) : undefined;
}

function uniqueWarnings(warnings: readonly string[]): string[] {
  return Array.from(new Set(warnings)).slice(0, 32);
}
