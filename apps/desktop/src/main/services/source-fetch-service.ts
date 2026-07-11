import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupFunction } from "node:net";
import net from "node:net";
import { PigeDomainError } from "@pige/domain";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { WebContentExtractorWorkerAdapter, type WebContentExtractorPort } from "./web-content-extractor-service";
import { WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS, type WebExtractionResult } from "./web-content-extractor-types";

export interface SourceFetchSnapshot {
  readonly originalUrl: string;
  readonly finalUrl: string;
  readonly canonicalUrl?: string;
  readonly contentType: string;
  readonly charset?: string;
  readonly title?: string;
  readonly byline?: string;
  readonly siteName?: string;
  readonly language?: string;
  readonly publishedTime?: string;
  readonly excerpt?: string;
  readonly imageReferences?: readonly string[];
  readonly extraction?: {
    readonly parserId: string;
    readonly engine: string;
    readonly version: string;
    readonly mode: string;
    readonly textCharacterCount: number;
    readonly elementCount?: number;
    readonly truncated: boolean;
  };
  readonly rawContent: string;
  readonly extractedText: string;
  readonly warnings: readonly string[];
}

type PigeFetchInit = RequestInit & { readonly dispatcher?: Dispatcher };
type SourceFetchImplementation = (url: string, init: PigeFetchInit) => Promise<Response>;

export interface SourceFetchServiceOptions {
  readonly fetchImpl?: typeof fetch;
  readonly lookup?: (hostname: string) => Promise<readonly string[]>;
  readonly extractor?: WebContentExtractorPort;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
}

interface ValidatedFetchTarget {
  readonly url: string;
  readonly hostname: string;
  readonly addresses: readonly string[];
}

interface FetchHandle {
  readonly response: Response;
  readonly signal: AbortSignal;
  dispose(): Promise<void>;
}

interface DecodedResponse {
  readonly text: string;
  readonly charset: string;
  readonly warnings: readonly string[];
}

interface HtmlExtractionResult extends Omit<WebExtractionResult, "parserId" | "engine" | "engineVersion" | "mode"> {
  readonly parserId: string;
  readonly engine: string;
  readonly engineVersion: string;
  readonly mode: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const SENSITIVE_QUERY_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|credential|key|password|secret|signature|sig|token)(?:$|[_-])/iu;

export class SourceFetchService {
  readonly #extractor: WebContentExtractorPort;
  readonly #fetchImpl: SourceFetchImplementation;
  readonly #lookup: (hostname: string) => Promise<readonly string[]>;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;
  readonly #pinValidatedAddresses: boolean;
  readonly #timeoutMs: number;

  constructor(options: SourceFetchServiceOptions = {}) {
    this.#extractor = options.extractor ?? new WebContentExtractorWorkerAdapter();
    this.#fetchImpl = options.fetchImpl
      ? ((url, init) => options.fetchImpl?.(url, init) as Promise<Response>)
      : (undiciFetch as unknown as SourceFetchImplementation);
    this.#lookup = options.lookup ?? lookupHostname;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#pinValidatedAddresses = !options.fetchImpl;
  }

  async fetchSnapshot(url: string): Promise<SourceFetchSnapshot> {
    const originalTarget = await this.#validateFetchableUrl(url);
    let currentTarget = originalTarget;
    const warnings: string[] = [];

    for (let redirectCount = 0; redirectCount <= this.#maxRedirects; redirectCount += 1) {
      const handle = await this.#fetchWithTimeout(currentTarget);
      let nextTarget: ValidatedFetchTarget | undefined;
      let contentType = "";
      let decoded: DecodedResponse | undefined;
      try {
        const response = handle.response;
        if (isRedirect(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            throw new PigeDomainError("url_fetch.redirect_missing_location", "The URL redirected without a Location header.");
          }
          if (redirectCount === this.#maxRedirects) {
            throw new PigeDomainError("url_fetch.too_many_redirects", "The URL redirected too many times.");
          }
          nextTarget = await this.#validateFetchableUrl(new URL(location, currentTarget.url).toString());
          warnings.push("redirected");
        } else {
          if (!response.ok) {
            throw new PigeDomainError("url_fetch.http_error", `The URL returned HTTP ${response.status}.`);
          }
          contentType = normalizeContentType(response.headers.get("content-type"));
          if (!isSupportedContentType(contentType)) {
            throw new PigeDomainError("url_fetch.unsupported_content_type", "The URL did not return readable text or HTML.");
          }
          decoded = await readResponseText(response, this.#maxBytes, contentType, handle.signal);
        }
      } catch (caught) {
        if (handle.signal.aborted && !(caught instanceof PigeDomainError)) {
          throw new PigeDomainError("url_fetch.timeout", "The URL fetch timed out while reading the response.");
        }
        throw caught;
      } finally {
        await handle.dispose();
      }

      if (nextTarget) {
        currentTarget = nextTarget;
        continue;
      }
      if (!decoded) throw new PigeDomainError("url_fetch.failed", "The URL response could not be decoded.");
      warnings.push(...decoded.warnings);
      if (!contentType.includes("html")) {
        const extractedText = normalizePlainText(decoded.text);
        if (!extractedText) warnings.push("empty_extracted_text");
        return {
          originalUrl: originalTarget.url,
          finalUrl: currentTarget.url,
          contentType,
          charset: decoded.charset,
          rawContent: decoded.text,
          extractedText,
          extraction: {
            parserId: "plain_text",
            engine: "node_text_decoder",
            version: process.versions.node,
            mode: "plain_text",
            textCharacterCount: extractedText.length,
            truncated: false
          },
          warnings: uniqueWarnings(warnings)
        };
      }

      const extraction = await this.#extractHtml(decoded.text, currentTarget.url);
      warnings.push(...extraction.warnings);
      if (!extraction.text.trim()) warnings.push("empty_extracted_text");
      return {
        originalUrl: originalTarget.url,
        finalUrl: currentTarget.url,
        ...(extraction.canonicalUrl ? { canonicalUrl: extraction.canonicalUrl } : {}),
        contentType,
        charset: decoded.charset,
        ...(extraction.title ? { title: extraction.title } : {}),
        ...(extraction.byline ? { byline: extraction.byline } : {}),
        ...(extraction.siteName ? { siteName: extraction.siteName } : {}),
        ...(extraction.language ? { language: extraction.language } : {}),
        ...(extraction.publishedTime ? { publishedTime: extraction.publishedTime } : {}),
        ...(extraction.excerpt ? { excerpt: extraction.excerpt } : {}),
        imageReferences: extraction.imageReferences,
        rawContent: decoded.text,
        extractedText: extraction.text,
        extraction: {
          parserId: extraction.parserId,
          engine: extraction.engine,
          version: extraction.engineVersion,
          mode: extraction.mode,
          textCharacterCount: extraction.textCharacterCount,
          elementCount: extraction.elementCount,
          truncated: extraction.truncated
        },
        warnings: uniqueWarnings(warnings)
      };
    }

    throw new PigeDomainError("url_fetch.too_many_redirects", "The URL redirected too many times.");
  }

  async #extractHtml(html: string, url: string): Promise<HtmlExtractionResult> {
    if (this.#extractor.isAvailable?.() === false) return fallbackHtmlExtraction(html, url, "readability_unavailable");
    try {
      return await this.#extractor.extract(html, url);
    } catch {
      return fallbackHtmlExtraction(html, url, "readability_worker_failed");
    }
  }

  async #validateFetchableUrl(value: string): Promise<ValidatedFetchTarget> {
    let parsed: URL;
    try {
      parsed = new URL(value.trim());
    } catch {
      throw new PigeDomainError("url_fetch.invalid_url", "URL capture requires a valid URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PigeDomainError("url_fetch.unsupported_scheme", "URL capture supports only HTTP and HTTPS.");
    }
    if (parsed.username || parsed.password) {
      throw new PigeDomainError("url_fetch.credentials_not_allowed", "URL capture does not allow embedded credentials.");
    }
    if (isLocalHostname(parsed.hostname)) {
      throw new PigeDomainError("url_fetch.private_network_blocked", "URL capture blocked a local or private network address.");
    }

    let addresses: readonly string[];
    try {
      addresses = await this.#lookup(parsed.hostname);
    } catch {
      throw new PigeDomainError("url_fetch.hostname_unreachable", "The URL hostname could not be resolved.");
    }
    const normalizedAddresses = Array.from(new Set(addresses.map(stripIpv6Brackets)));
    if (normalizedAddresses.length === 0 || normalizedAddresses.some(isBlockedAddress)) {
      throw new PigeDomainError("url_fetch.private_network_blocked", "URL capture blocked a local or private network address.");
    }

    parsed.hash = "";
    return { url: parsed.toString(), hostname: stripIpv6Brackets(parsed.hostname), addresses: normalizedAddresses };
  }

  async #fetchWithTimeout(target: ValidatedFetchTarget): Promise<FetchHandle> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const dispatcher = this.#pinValidatedAddresses
      ? new Agent({
        allowH2: false,
        connections: 1,
        pipelining: 1,
        autoSelectFamily: target.addresses.some((address) => net.isIP(address) === 4) &&
          target.addresses.some((address) => net.isIP(address) === 6),
        connect: { lookup: createPinnedLookup(target.hostname, target.addresses) }
      })
      : undefined;
    try {
      const response = await this.#fetchImpl(target.url, {
        redirect: "manual",
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
        headers: {
          "User-Agent": "Pige/0.1 URL Capture",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1"
        }
      });
      let disposed = false;
      return {
        response,
        signal: controller.signal,
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          clearTimeout(timeout);
          if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
          if (dispatcher) {
            try {
              await dispatcher.close();
            } catch {
              await dispatcher.destroy().catch(() => undefined);
            }
          }
        }
      };
    } catch (caught) {
      clearTimeout(timeout);
      if (dispatcher) await dispatcher.destroy().catch(() => undefined);
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) {
        throw new PigeDomainError("url_fetch.timeout", "The URL fetch timed out.");
      }
      throw new PigeDomainError("url_fetch.failed", "The URL could not be fetched.");
    }
  }
}

export function createPinnedLookup(expectedHostname: string, addresses: readonly string[]): LookupFunction {
  const normalizedHostname = stripIpv6Brackets(expectedHostname).toLocaleLowerCase();
  const records = addresses.map((address) => ({ address, family: net.isIP(address) })).filter((record) => record.family === 4 || record.family === 6);
  return (requestedHostname, options, callback) => {
    if (stripIpv6Brackets(requestedHostname).toLocaleLowerCase() !== normalizedHostname) {
      const error = Object.assign(new Error("Pinned DNS lookup hostname mismatch."), { code: "EACCES" });
      callback(error, "", 0);
      return;
    }
    const requestedFamily = typeof options.family === "number" ? options.family : 0;
    const eligible = requestedFamily === 4 || requestedFamily === 6
      ? records.filter((record) => record.family === requestedFamily)
      : records;
    if (eligible.length === 0) {
      const error = Object.assign(new Error("No validated address matches the requested family."), { code: "ENOTFOUND" });
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, eligible);
      return;
    }
    const selected = eligible[0];
    if (!selected) {
      callback(Object.assign(new Error("No validated address is available."), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

async function lookupHostname(hostname: string): Promise<readonly string[]> {
  const literal = stripIpv6Brackets(hostname);
  if (net.isIP(literal)) return [literal];
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function normalizeContentType(value: string | null): string {
  return (value ?? "text/html").split(";", 1)[0]?.trim().toLocaleLowerCase() || "text/html";
}

function isSupportedContentType(contentType: string): boolean {
  return ["text/html", "application/xhtml+xml", "text/plain"].includes(contentType);
}

async function readResponseText(
  response: Response,
  maxBytes: number,
  contentType: string,
  signal: AbortSignal
): Promise<DecodedResponse> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PigeDomainError("url_fetch.response_too_large", "The URL response was larger than the allowed capture limit.");
  }
  const body = await readResponseBytes(response, maxBytes, signal);
  const charsetWarnings: string[] = [];
  const requestedCharset = detectCharset(body, response.headers.get("content-type"), contentType.includes("html"));
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(requestedCharset, { fatal: false });
  } catch {
    decoder = new TextDecoder("utf-8", { fatal: false });
    charsetWarnings.push("unsupported_charset_fallback");
  }
  return { text: decoder.decode(body), charset: decoder.encoding, warnings: charsetWarnings };
}

async function readResponseBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await waitForBody(response.arrayBuffer(), signal));
    if (bytes.byteLength > maxBytes) {
      throw new PigeDomainError("url_fetch.response_too_large", "The URL response was larger than the allowed capture limit.");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await waitForBody(reader.read(), signal, () => reader.cancel());
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new PigeDomainError("url_fetch.response_too_large", "The URL response was larger than the allowed capture limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function waitForBody<T>(operation: Promise<T>, signal: AbortSignal, cancel?: () => Promise<unknown>): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      void cancel?.().catch(() => undefined);
      finish(() => reject(createAbortError()));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function createAbortError(): Error {
  return Object.assign(new Error("The URL response body read was aborted."), { name: "AbortError" });
}

function detectCharset(body: Uint8Array, contentTypeHeader: string | null, isHtml: boolean): string {
  const headerCharset = /charset\s*=\s*["']?([^\s;"']+)/iu.exec(contentTypeHeader ?? "")?.[1];
  if (headerCharset) return headerCharset;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return "utf-8";
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return "utf-16le";
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return "utf-16be";
  if (isHtml) {
    const head = Buffer.from(body.subarray(0, Math.min(body.length, 4096))).toString("latin1");
    const direct = /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/iu.exec(head)?.[1];
    if (direct) return direct;
    const httpEquiv = /<meta\b[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([^\s;"']+)/iu.exec(head)?.[1];
    if (httpEquiv) return httpEquiv;
  }
  return "utf-8";
}

function fallbackHtmlExtraction(html: string, baseUrl: string, warning: string): HtmlExtractionResult {
  const metadata = extractFallbackHtmlMetadata(html, baseUrl);
  const unboundedText = extractFallbackReadableText(html);
  const truncated = unboundedText.length > WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS;
  const text = truncated ? unboundedText.slice(0, WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS).trimEnd() : unboundedText;
  return {
    parserId: "pige_basic_html",
    engine: "pige_domless_fallback",
    engineVersion: "1",
    mode: "regex_fallback",
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.canonicalUrl ? { canonicalUrl: metadata.canonicalUrl } : {}),
    text,
    textCharacterCount: text.length,
    elementCount: 0,
    truncated,
    imageReferences: [],
    warnings: [warning, ...(truncated ? ["extracted_text_truncated"] : []), ...(text ? [] : ["empty_extracted_text"])]
  };
}

function extractFallbackHtmlMetadata(html: string, baseUrl: string): { readonly title?: string; readonly canonicalUrl?: string } {
  const title = decodeHtmlEntities((/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1] ?? "").replace(/\s+/gu, " ").trim());
  const canonicalTag = /<link\b[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/iu.exec(html)?.[0];
  const href = canonicalTag ? /\bhref=["']([^"']+)["']/iu.exec(canonicalTag)?.[1] : undefined;
  let canonicalUrl: string | undefined;
  if (href) {
    try {
      const parsed = new URL(href, baseUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        parsed.username = "";
        parsed.password = "";
        parsed.hash = "";
        canonicalUrl = redactSensitiveUrl(parsed.toString());
      }
    } catch {
      canonicalUrl = undefined;
    }
  }
  return { ...(title ? { title: title.slice(0, 240) } : {}), ...(canonicalUrl ? { canonicalUrl } : {}) };
}

function extractFallbackReadableText(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ");
  const withBreaks = withoutHidden
    .replace(/<(h[1-6]|p|div|section|article|header|footer|li|tr|br)\b[^>]*>/giu, "\n")
    .replace(/<\/(h[1-6]|p|div|section|article|header|footer|li|tr)>/giu, "\n");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/gu, " "))
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;/giu, "'");
}

function normalizePlainText(value: string): string {
  return value.replaceAll("\u0000", "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function isLocalHostname(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLocaleLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function isBlockedAddress(address: string): boolean {
  const literal = stripIpv6Brackets(address);
  const family = net.isIP(literal);
  if (family === 4) return isBlockedIpv4(literal);
  if (family === 6) return isBlockedIpv6(literal);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const words = parseIpv6Words(address);
  if (!words) return true;
  const [first = 0, second = 0, third = 0, fourth = 0, fifth = 0, sixth = 0, seventh = 0, eighth = 0] = words;
  const isIpv4Mapped = first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0xffff;
  if (isIpv4Mapped) return isBlockedIpv4(`${seventh >>> 8}.${seventh & 0xff}.${eighth >>> 8}.${eighth & 0xff}`);

  return (
    (first === 0 && second === 0 && third === 0 && fourth === 0 && fifth === 0 && sixth === 0) ||
    (first & 0xe000) !== 0x2000 ||
    (first === 0x2001 && second === 0) ||
    (first === 0x2001 && second === 0x0002 && third === 0) ||
    (first === 0x2001 && ((second & 0xfff0) === 0x0010 || (second & 0xfff0) === 0x0020)) ||
    (first === 0x2001 && second === 0x0db8) ||
    first === 0x2002 ||
    (first === 0x3fff && (second & 0xf000) === 0)
  );
}

function parseIpv6Words(address: string): readonly number[] | undefined {
  const normalized = address.toLocaleLowerCase();
  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = parseIpv6Half(halves[0] ?? "");
  const right = parseIpv6Half(halves[1] ?? "");
  if (!left || !right) return undefined;
  if (halves.length === 1) return left.length === 8 ? left : undefined;
  const omitted = 8 - left.length - right.length;
  if (omitted < 1) return undefined;
  return [...left, ...Array.from({ length: omitted }, () => 0), ...right];
}

function parseIpv6Half(value: string): number[] | undefined {
  if (!value) return [];
  const segments = value.split(":");
  const words: number[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.includes(".")) {
      if (index !== segments.length - 1 || net.isIP(segment) !== 4) return undefined;
      const bytes = segment.split(".").map((part) => Number.parseInt(part, 10));
      const [a = 0, b = 0, c = 0, d = 0] = bytes;
      words.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[a-f0-9]{1,4}$/u.test(segment)) return undefined;
    words.push(Number.parseInt(segment, 16));
  }
  return words;
}

function uniqueWarnings(warnings: readonly string[]): string[] {
  return Array.from(new Set(warnings)).slice(0, 32);
}

export function redactSensitiveUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return value;
  }
}
