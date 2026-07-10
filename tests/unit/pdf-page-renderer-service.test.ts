import { EventEmitter } from "node:events";
import type { WorkerOptions } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
  PdfPageRendererService,
  type PdfPageRendererWorkerPort
} from "../../apps/desktop/src/main/services/pdf-page-renderer-service";
import {
  PDF_PAGE_RENDERER_DEFAULT_LIMITS,
  PDF_PAGE_RENDERER_ERROR_MESSAGES,
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_TIMEOUT_MS,
  PDF_PAGE_RENDERER_VERSION,
  PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB,
  type PdfPageRendererRequest,
  type PdfPageRendererWorkerResponse
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

describe("PDF page renderer service", () => {
  it("locks the default PDF, page, pixel, byte, timeout, and heap budgets", () => {
    expect(PDF_PAGE_RENDERER_DEFAULT_LIMITS).toEqual({
      maxPdfBytes: 200 * 1024 * 1024,
      maxPages: 20,
      maxEdge: 3_072,
      maxPixelsPerPage: 9_437_184,
      maxPngBytesPerPage: 16 * 1024 * 1024,
      maxTotalPngBytes: 64 * 1024 * 1024
    });
    expect(PDF_PAGE_RENDERER_TIMEOUT_MS).toBe(120_000);
    expect(PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB).toBe(512);
  });

  it("detects both exact bundled runtime dependencies", () => {
    const available = new PdfPageRendererService({ resolveModule: (moduleId) => `/modules/${moduleId}` });
    const unavailable = new PdfPageRendererService({ resolveModule: () => { throw new Error("missing"); } });

    expect(available.isAvailable()).toBe(true);
    expect(unavailable.isAvailable()).toBe(false);
  });

  it("deduplicates, sorts, and visibly truncates candidates before bounded rendering", async () => {
    let postedRequest: PdfPageRendererRequest | undefined;
    let workerOptions: WorkerOptions | undefined;
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker((request, worker) => {
      postedRequest = request;
      queueMicrotask(() => worker.emit("message", successResponse(request)));
    }, workers, (options) => { workerOptions = options; });
    const candidates = [3, 1, 2, 2, ...Array.from({ length: 18 }, (_, index) => index + 4)];

    const result = await service.renderPages("/tmp/bounded-scan.pdf", candidates);

    expect(postedRequest?.pageCandidates).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(result.requestedPages).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(result.renderedPages).toEqual(result.requestedPages);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "page_candidates_deduplicated",
      "page_candidates_sorted",
      "page_limit_truncated"
    ]);
    expect(result.truncated).toBe(true);
    expect(workerOptions?.resourceLimits?.maxOldGenerationSizeMb).toBe(PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB);
    expect(workers[0]?.terminated).toBe(true);
  });

  it("rejects empty, fractional, zero, and relative-path requests before spawning a worker", async () => {
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker(() => undefined, workers);

    await expect(service.renderPages("/tmp/source.pdf", [])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.invalid_page"
    });
    await expect(service.renderPages("/tmp/source.pdf", [1.5])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.invalid_page"
    });
    await expect(service.renderPages("/tmp/source.pdf", [0])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.invalid_page"
    });
    await expect(service.renderPages("relative/source.pdf", [1])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.invalid_request"
    });
    expect(workers).toHaveLength(0);
  });

  it("strictly rejects uncorrelated and malformed worker responses", async () => {
    const wrongCorrelation = serviceWithWorker((request, worker) => {
      const response = successResponse(request);
      queueMicrotask(() => worker.emit("message", { ...response, requestId: "wrong-request" }));
    });
    await expect(wrongCorrelation.renderPages("/tmp/source.pdf", [1])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.worker_protocol"
    });

    const invalidPngSize = serviceWithWorker((request, worker) => {
      const response = successResponse(request);
      if (!response.ok) throw new Error("Expected success fixture.");
      const page = response.result.pages[0];
      if (!page) throw new Error("Expected rendered fixture page.");
      queueMicrotask(() => worker.emit("message", {
        ...response,
        result: {
          ...response.result,
          pages: [{ ...page, pngByteSize: page.pngByteSize + 1 }]
        }
      }));
    });
    await expect(invalidPngSize.renderPages("/tmp/source.pdf", [1])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.worker_protocol"
    });
  });

  it("terminates timed-out workers and maps worker events without leaking their messages", async () => {
    const timeoutWorkers: FakeWorker[] = [];
    const timeoutService = serviceWithWorker(() => undefined, timeoutWorkers, undefined, 10);
    await expect(timeoutService.renderPages("/private/source-name.pdf", [1])).rejects.toMatchObject({
      code: "parser.pdf_page_renderer.timeout",
      message: PDF_PAGE_RENDERER_ERROR_MESSAGES["parser.pdf_page_renderer.timeout"]
    });
    expect(timeoutWorkers[0]?.terminated).toBe(true);

    const failureWorkers: FakeWorker[] = [];
    const failureService = serviceWithWorker((_request, worker) => {
      queueMicrotask(() => worker.emit("error", new Error("/private/source-name.pdf failed")));
    }, failureWorkers);
    let failure: unknown;
    try {
      await failureService.renderPages("/private/source-name.pdf", [1]);
    } catch (caught) {
      failure = caught;
    }
    expect(failure).toMatchObject({
      code: "parser.pdf_page_renderer.worker_failed",
      message: PDF_PAGE_RENDERER_ERROR_MESSAGES["parser.pdf_page_renderer.worker_failed"]
    });
    expect((failure as Error).message).not.toContain("source-name.pdf");
    expect(failureWorkers[0]?.terminated).toBe(true);
  });

  it("does not trust a worker failure message even when its error code is known", async () => {
    const service = serviceWithWorker((request, worker) => {
      queueMicrotask(() => worker.emit("message", {
        protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        error: {
          code: "parser.pdf_page_renderer.source_missing",
          message: "/private/leaked-source.pdf"
        }
      }));
    });

    const rejection = service.renderPages("/private/leaked-source.pdf", [1]);
    await expect(rejection).rejects.toMatchObject({ code: "parser.pdf_page_renderer.worker_protocol" });
    await expect(rejection).rejects.not.toThrow(/leaked-source/u);
  });

  it("terminates the renderer worker when cooperative cancellation aborts the request", async () => {
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker(() => undefined, workers);
    const controller = new AbortController();
    const rendering = service.renderPages("/tmp/cancelled.pdf", [1], controller.signal);

    controller.abort();

    await expect(rendering).rejects.toBeInstanceOf(JobCancellationError);
    expect(workers[0]?.terminated).toBe(true);
  });
});

type WorkerHandler = (request: PdfPageRendererRequest, worker: FakeWorker) => void;

class FakeWorker extends EventEmitter implements PdfPageRendererWorkerPort {
  terminated = false;
  readonly #handler: WorkerHandler;

  constructor(handler: WorkerHandler) {
    super();
    this.#handler = handler;
  }

  postMessage(value: PdfPageRendererRequest): void {
    this.#handler(value, this);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

function serviceWithWorker(
  handler: WorkerHandler,
  workers: FakeWorker[] = [],
  captureOptions?: (options: WorkerOptions) => void,
  timeoutMs = 1_000
): PdfPageRendererService {
  return new PdfPageRendererService({
    workerUrl: new URL("file:///unused-pdf-page-renderer-worker.js"),
    timeoutMs,
    resolveModule: () => "/resolved",
    workerFactory: (_workerUrl, options) => {
      captureOptions?.(options);
      const worker = new FakeWorker(handler);
      workers.push(worker);
      return worker;
    }
  });
}

function successResponse(request: PdfPageRendererRequest): PdfPageRendererWorkerResponse {
  const requestedPages = request.pageCandidates.slice(0, request.limits.maxPages);
  const pages = requestedPages.map((page) => {
    const png = Uint8Array.from(ONE_PIXEL_PNG);
    return {
      requestedPage: page,
      renderedPage: page,
      locator: `page:${page}`,
      mimeType: "image/png" as const,
      png,
      width: 1,
      height: 1,
      pngByteSize: png.byteLength
    };
  });
  const truncated = request.pageCandidates.length > request.limits.maxPages;
  return {
    protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: true,
    result: {
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      rendererId: PDF_PAGE_RENDERER_ID,
      rendererVersion: PDF_PAGE_RENDERER_VERSION,
      pageCount: request.pageCandidates.at(-1) ?? 1,
      requestedPages,
      renderedPages: requestedPages,
      pages,
      totalPngByteSize: pages.reduce((total, page) => total + page.pngByteSize, 0),
      warnings: truncated ? [{ code: "page_limit_truncated" }] : [],
      truncated
    }
  };
}
