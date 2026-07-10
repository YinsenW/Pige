import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { extractWebContent } from "../services/web-content-extractor-core";
import type { WebExtractorRequest, WebExtractorWorkerResponse } from "../services/web-content-extractor-types";

if (!parentPort) {
  throw new Error("Web extractor worker must run in a worker thread.");
}
const workerPort = parentPort;

workerPort.on("message", (request: WebExtractorRequest) => {
  try {
    const result = extractWebContent(request);
    const response: WebExtractorWorkerResponse = { requestId: request.requestId, ok: true, result };
    workerPort.postMessage(response);
  } catch (caught) {
    const error = caught instanceof PigeDomainError
      ? caught
      : new PigeDomainError("web_extractor.failed", "Readable web extraction failed.");
    const response: WebExtractorWorkerResponse = {
      requestId: request.requestId,
      ok: false,
      error: { code: error.code, message: error.message }
    };
    workerPort.postMessage(response);
  }
});
