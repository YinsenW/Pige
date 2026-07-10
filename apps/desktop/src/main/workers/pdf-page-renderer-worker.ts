import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { renderPdfPages } from "../services/pdf-page-renderer-core";
import {
  PDF_PAGE_RENDERER_ERROR_MESSAGES,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  type PdfPageRendererErrorCode,
  type PdfPageRendererWorkerResponse
} from "../services/pdf-page-renderer-types";

if (!parentPort) throw new Error("PDF page renderer worker must run in a worker thread.");
const workerPort = parentPort;

workerPort.once("message", (request: unknown) => {
  const requestId = safeRequestId(request);
  void renderPdfPages(request)
    .then((result) => {
      const response: PdfPageRendererWorkerResponse = {
        protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
        requestId,
        ok: true,
        result
      };
      const transferList = result.pages.map((page) => page.png.buffer as ArrayBuffer);
      workerPort.postMessage(response, transferList);
    })
    .catch((caught: unknown) => {
      const code = stableWorkerErrorCode(caught);
      const response: PdfPageRendererWorkerResponse = {
        protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: { code, message: PDF_PAGE_RENDERER_ERROR_MESSAGES[code] }
      };
      workerPort.postMessage(response);
    });
});

function stableWorkerErrorCode(caught: unknown): PdfPageRendererErrorCode {
  if (
    caught instanceof PigeDomainError &&
    Object.hasOwn(PDF_PAGE_RENDERER_ERROR_MESSAGES, caught.code) &&
    ![
      "parser.pdf_page_renderer.invalid_page",
      "parser.pdf_page_renderer.unavailable",
      "parser.pdf_page_renderer.timeout",
      "parser.pdf_page_renderer.worker_protocol",
      "parser.pdf_page_renderer.worker_failed"
    ].includes(caught.code)
  ) {
    return caught.code as PdfPageRendererErrorCode;
  }
  return "parser.pdf_page_renderer.failed";
}

function safeRequestId(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.requestId)
  ) {
    return value.requestId;
  }
  return "invalid-request";
}
