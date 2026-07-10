import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { extractPdfText } from "../services/pdf-parser-core";
import type { PdfParserRequest, PdfParserWorkerResponse } from "../services/pdf-parser-types";

if (!parentPort) {
  throw new Error("PDF parser worker must run in a worker thread.");
}
const workerPort = parentPort;

workerPort.on("message", (request: PdfParserRequest) => {
  void extractPdfText(request)
    .then((result) => {
      const response: PdfParserWorkerResponse = { requestId: request.requestId, ok: true, result };
      workerPort.postMessage(response);
    })
    .catch((caught: unknown) => {
      const error = caught instanceof PigeDomainError
        ? caught
        : new PigeDomainError("parser.pdf.failed", "PDF text extraction failed.");
      const response: PdfParserWorkerResponse = {
        requestId: request.requestId,
        ok: false,
        error: { code: error.code, message: error.message }
      };
      workerPort.postMessage(response);
    });
});
