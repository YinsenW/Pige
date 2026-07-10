import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { PDF_PAGE_RENDERER_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/pdf-page-renderer-entry";
import { JobCancellationError } from "./job-execution-control";
import {
  PDF_PAGE_RENDERER_DEFAULT_LIMITS,
  PDF_PAGE_RENDERER_ERROR_MESSAGES,
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_TIMEOUT_MS,
  PDF_PAGE_RENDERER_VERSION,
  PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB,
  type PdfPageRendererErrorCode,
  type PdfPageRendererLimits,
  type PdfPageRendererRequest,
  type PdfPageRendererResult,
  type PdfPageRendererWarning,
  type PdfPageRendererWorkerFailure,
  type PdfPageRendererWorkerResponse
} from "./pdf-page-renderer-types";

const WORKER_ERROR_CODES = new Set<PdfPageRendererErrorCode>([
  "parser.pdf_page_renderer.invalid_request",
  "parser.pdf_page_renderer.source_missing",
  "parser.pdf_page_renderer.file_too_large",
  "parser.pdf_page_renderer.password_required",
  "parser.pdf_page_renderer.invalid_pdf",
  "parser.pdf_page_renderer.page_out_of_range",
  "parser.pdf_page_renderer.failed"
]);

export interface PdfPageRendererPort {
  isAvailable(): boolean;
  renderPages(filePath: string, pageCandidates: readonly number[], signal?: AbortSignal): Promise<PdfPageRendererResult>;
}

export interface PdfPageRendererWorkerPort {
  once(event: "message", listener: (value: unknown) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  postMessage(value: PdfPageRendererRequest): void;
  terminate(): Promise<number>;
}

export type PdfPageRendererWorkerFactory = (
  workerUrl: URL,
  options: WorkerOptions
) => PdfPageRendererWorkerPort;

export interface PdfPageRendererServiceOptions {
  readonly workerUrl?: URL;
  readonly timeoutMs?: number;
  readonly limits?: PdfPageRendererLimits;
  readonly resolveModule?: (moduleId: string) => string;
  readonly workerFactory?: PdfPageRendererWorkerFactory;
}

interface NormalizedPageSelection {
  readonly pageCandidates: readonly number[];
  readonly warnings: readonly PdfPageRendererWarning[];
}

export class PdfPageRendererService implements PdfPageRendererPort {
  readonly #limits: PdfPageRendererLimits;
  readonly #resolveModule: (moduleId: string) => string;
  readonly #timeoutMs: number;
  readonly #workerFactory: PdfPageRendererWorkerFactory;
  readonly #workerUrl: URL;

  constructor(options: PdfPageRendererServiceOptions = {}) {
    this.#workerUrl = options.workerUrl ?? new URL(PDF_PAGE_RENDERER_WORKER_ENTRY_RELATIVE_PATH, import.meta.url);
    this.#timeoutMs = options.timeoutMs ?? PDF_PAGE_RENDERER_TIMEOUT_MS;
    this.#limits = options.limits ?? PDF_PAGE_RENDERER_DEFAULT_LIMITS;
    this.#resolveModule = options.resolveModule ?? ((moduleId) => createRequire(import.meta.url).resolve(moduleId));
    this.#workerFactory = options.workerFactory ?? ((workerUrl, workerOptions) => new Worker(workerUrl, workerOptions));
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("pdfjs-dist/package.json") &&
        this.#resolveModule("@napi-rs/canvas/package.json")
      );
    } catch {
      return false;
    }
  }

  renderPages(filePath: string, pageCandidates: readonly number[], signal?: AbortSignal): Promise<PdfPageRendererResult> {
    if (signal?.aborted) return Promise.reject(new JobCancellationError());
    if (!this.isAvailable()) {
      return Promise.reject(rendererError("parser.pdf_page_renderer.unavailable"));
    }
    if (
      typeof filePath !== "string" ||
      filePath.length === 0 ||
      filePath.length > 32_768 ||
      filePath.includes("\u0000") ||
      !path.isAbsolute(filePath)
    ) {
      return Promise.reject(rendererError("parser.pdf_page_renderer.invalid_request"));
    }

    let selection: NormalizedPageSelection;
    try {
      selection = normalizePageCandidates(pageCandidates);
    } catch (caught) {
      return Promise.reject(caught);
    }
    const request: PdfPageRendererRequest = {
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      requestId: randomUUID(),
      filePath,
      pageCandidates: selection.pageCandidates,
      limits: this.#limits
    };

    let worker: PdfPageRendererWorkerPort;
    try {
      worker = this.#workerFactory(this.#workerUrl, {
        name: "pige-pdf-page-renderer",
        resourceLimits: { maxOldGenerationSizeMb: PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB }
      });
    } catch {
      return Promise.reject(rendererError("parser.pdf_page_renderer.worker_failed"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        void worker.terminate().then(callback, callback);
      };
      const onAbort = (): void => {
        finish(() => reject(new JobCancellationError()));
      };

      timeout = setTimeout(() => {
        finish(() => reject(rendererError("parser.pdf_page_renderer.timeout")));
      }, this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message) => {
        let response: PdfPageRendererWorkerResponse;
        try {
          response = parseWorkerResponse(message, request);
        } catch {
          finish(() => reject(rendererError("parser.pdf_page_renderer.worker_protocol")));
          return;
        }
        if (!response.ok) {
          finish(() => reject(rendererError(response.error.code)));
          return;
        }
        const result = selection.warnings.length === 0
          ? response.result
          : { ...response.result, warnings: [...selection.warnings, ...response.result.warnings] };
        finish(() => resolve(result));
      });
      worker.once("error", () => {
        finish(() => reject(rendererError("parser.pdf_page_renderer.worker_failed")));
      });
      worker.once("exit", () => {
        if (!settled) finish(() => reject(rendererError("parser.pdf_page_renderer.worker_failed")));
      });

      try {
        worker.postMessage(request);
      } catch {
        finish(() => reject(rendererError("parser.pdf_page_renderer.worker_failed")));
      }
    });
  }
}

export function normalizePageCandidates(value: readonly number[]): NormalizedPageSelection {
  if (!Array.isArray(value) || value.length === 0 || value.length > PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES) {
    throw rendererError("parser.pdf_page_renderer.invalid_page");
  }
  for (const page of value) {
    if (!isPositiveSafeInteger(page)) throw rendererError("parser.pdf_page_renderer.invalid_page");
  }

  const deduplicated = Array.from(new Set(value));
  const sorted = [...deduplicated].sort((left, right) => left - right);
  const warnings: PdfPageRendererWarning[] = [];
  if (deduplicated.length !== value.length) warnings.push({ code: "page_candidates_deduplicated" });
  if (!arraysEqual(deduplicated, sorted)) warnings.push({ code: "page_candidates_sorted" });
  return { pageCandidates: sorted, warnings };
}

function parseWorkerResponse(value: unknown, request: PdfPageRendererRequest): PdfPageRendererWorkerResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== PDF_PAGE_RENDERER_PROTOCOL_VERSION ||
    value.requestId !== request.requestId ||
    typeof value.ok !== "boolean"
  ) {
    throw new Error("invalid envelope");
  }
  if (value.ok === false) return parseWorkerFailure(value);
  if (!hasExactKeys(value, ["protocolVersion", "requestId", "ok", "result"])) {
    throw new Error("invalid success envelope");
  }
  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: true,
    result: parseRendererResult(value.result, request)
  };
}

function parseWorkerFailure(value: Record<string, unknown>): PdfPageRendererWorkerFailure {
  if (!hasExactKeys(value, ["protocolVersion", "requestId", "ok", "error"]) || !isRecord(value.error)) {
    throw new Error("invalid failure envelope");
  }
  const error = value.error;
  if (
    !hasExactKeys(error, ["code", "message"]) ||
    typeof error.code !== "string" ||
    !WORKER_ERROR_CODES.has(error.code as PdfPageRendererErrorCode) ||
    error.message !== PDF_PAGE_RENDERER_ERROR_MESSAGES[error.code as PdfPageRendererErrorCode]
  ) {
    throw new Error("invalid worker error");
  }
  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    requestId: value.requestId as string,
    ok: false,
    error: {
      code: error.code as PdfPageRendererErrorCode,
      message: PDF_PAGE_RENDERER_ERROR_MESSAGES[error.code as PdfPageRendererErrorCode]
    }
  };
}

function parseRendererResult(value: unknown, request: PdfPageRendererRequest): PdfPageRendererResult {
  const pageCount = isRecord(value) ? value.pageCount : undefined;
  const declaredTotalPngByteSize = isRecord(value) ? value.totalPngByteSize : undefined;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "rendererId",
      "rendererVersion",
      "pageCount",
      "requestedPages",
      "renderedPages",
      "pages",
      "totalPngByteSize",
      "warnings",
      "truncated"
    ]) ||
    value.protocolVersion !== PDF_PAGE_RENDERER_PROTOCOL_VERSION ||
    value.rendererId !== PDF_PAGE_RENDERER_ID ||
    value.rendererVersion !== PDF_PAGE_RENDERER_VERSION ||
    !isPositiveSafeInteger(pageCount) ||
    !Array.isArray(value.requestedPages) ||
    !Array.isArray(value.renderedPages) ||
    !Array.isArray(value.pages) ||
    !Array.isArray(value.warnings) ||
    typeof value.truncated !== "boolean" ||
    typeof declaredTotalPngByteSize !== "number" ||
    !Number.isSafeInteger(declaredTotalPngByteSize) ||
    declaredTotalPngByteSize < 0
  ) {
    throw new Error("invalid renderer result");
  }

  if (request.pageCandidates.some((page) => page > pageCount)) {
    throw new Error("invalid page count");
  }
  const expectedRequestedPages = request.pageCandidates.slice(0, request.limits.maxPages);
  const requestedPages = parsePositiveIntegerList(value.requestedPages);
  if (!arraysEqual(requestedPages, expectedRequestedPages)) throw new Error("invalid requested pages");

  const pages = value.pages.map((page) => parseRenderedPage(page, request, pageCount));
  const renderedPages = parsePositiveIntegerList(value.renderedPages);
  const pageNumbers = pages.map((page) => page.renderedPage);
  if (!arraysEqual(renderedPages, pageNumbers) || !isOrderedSubset(renderedPages, requestedPages)) {
    throw new Error("invalid rendered pages");
  }
  const totalPngByteSize = pages.reduce((total, page) => total + page.pngByteSize, 0);
  if (
    totalPngByteSize !== declaredTotalPngByteSize ||
    totalPngByteSize > request.limits.maxTotalPngBytes
  ) {
    throw new Error("invalid total PNG size");
  }

  const warnings = parseWarnings(value.warnings, requestedPages);
  const pageLimitTruncated = request.pageCandidates.length > request.limits.maxPages;
  if (warnings.some((warning) => warning.code === "page_candidates_deduplicated" || warning.code === "page_candidates_sorted")) {
    throw new Error("invalid worker warning");
  }
  if (warnings.some((warning) => warning.code === "page_limit_truncated") !== pageLimitTruncated) {
    throw new Error("invalid page-limit warning");
  }
  const hasIncompleteOutput = renderedPages.length !== requestedPages.length;
  if (value.truncated !== (pageLimitTruncated || hasIncompleteOutput)) {
    throw new Error("invalid truncation state");
  }
  if (hasIncompleteOutput && !warnings.some((warning) => (
    warning.code === "page_render_failed" ||
    warning.code === "page_png_limit_exceeded" ||
    warning.code === "total_png_limit_exceeded"
  ))) {
    throw new Error("missing incomplete-output warning");
  }

  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    rendererId: PDF_PAGE_RENDERER_ID,
    rendererVersion: PDF_PAGE_RENDERER_VERSION,
    pageCount,
    requestedPages,
    renderedPages,
    pages,
    totalPngByteSize,
    warnings,
    truncated: value.truncated
  };
}

function parseRenderedPage(value: unknown, request: PdfPageRendererRequest, pageCount: number) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "requestedPage",
      "renderedPage",
      "locator",
      "mimeType",
      "png",
      "width",
      "height",
      "pngByteSize"
    ]) ||
    !isPositiveSafeInteger(value.requestedPage) ||
    value.requestedPage > pageCount ||
    value.renderedPage !== value.requestedPage ||
    value.locator !== `page:${value.requestedPage}` ||
    value.mimeType !== "image/png" ||
    !(value.png instanceof Uint8Array) ||
    !isPositiveSafeInteger(value.width) ||
    !isPositiveSafeInteger(value.height) ||
    !isPositiveSafeInteger(value.pngByteSize) ||
    value.pngByteSize !== value.png.byteLength ||
    value.pngByteSize > request.limits.maxPngBytesPerPage ||
    value.width > request.limits.maxEdge ||
    value.height > request.limits.maxEdge ||
    value.width > Math.floor(request.limits.maxPixelsPerPage / value.height) ||
    !hasMatchingPngHeader(value.png, value.width, value.height)
  ) {
    throw new Error("invalid rendered page");
  }
  return {
    requestedPage: value.requestedPage,
    renderedPage: value.requestedPage,
    locator: value.locator,
    mimeType: "image/png" as const,
    png: value.png,
    width: value.width,
    height: value.height,
    pngByteSize: value.pngByteSize
  };
}

function parseWarnings(values: readonly unknown[], requestedPages: readonly number[]): PdfPageRendererWarning[] {
  if (values.length > 64) throw new Error("too many warnings");
  const warnings = values.map((value) => {
    if (!isRecord(value) || typeof value.code !== "string") throw new Error("invalid warning");
    const pageRequired = value.code === "page_render_failed" ||
      value.code === "page_png_limit_exceeded" ||
      value.code === "total_png_limit_exceeded";
    if (pageRequired) {
      if (!hasExactKeys(value, ["code", "page"]) || !isPositiveSafeInteger(value.page) || !requestedPages.includes(value.page)) {
        throw new Error("invalid page warning");
      }
      return { code: value.code, page: value.page } as PdfPageRendererWarning;
    }
    if (value.code !== "page_limit_truncated" || !hasExactKeys(value, ["code"])) {
      throw new Error("invalid warning code");
    }
    return { code: value.code } as PdfPageRendererWarning;
  });
  const warningKeys = warnings.map((warning) => `${warning.code}:${warning.page ?? ""}`);
  if (new Set(warningKeys).size !== warningKeys.length) throw new Error("duplicate warning");
  return warnings;
}

function hasMatchingPngHeader(png: Uint8Array, width: number, height: number): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.byteLength < 24 || !signature.every((byte, index) => png[index] === byte)) return false;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return view.getUint32(16) === width && view.getUint32(20) === height;
}

function parsePositiveIntegerList(values: readonly unknown[]): number[] {
  const pages = values.map((value) => {
    if (!isPositiveSafeInteger(value)) throw new Error("invalid page list");
    return value;
  });
  if (new Set(pages).size !== pages.length || !pages.every((page, index) => index === 0 || page > (pages[index - 1] ?? 0))) {
    throw new Error("invalid page order");
  }
  return pages;
}

function isOrderedSubset(values: readonly number[], candidates: readonly number[]): boolean {
  let candidateIndex = 0;
  for (const value of values) {
    while (candidateIndex < candidates.length && candidates[candidateIndex] !== value) candidateIndex += 1;
    if (candidateIndex >= candidates.length) return false;
    candidateIndex += 1;
  }
  return true;
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rendererError(code: PdfPageRendererErrorCode): PigeDomainError {
  return new PigeDomainError(code, PDF_PAGE_RENDERER_ERROR_MESSAGES[code]);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
