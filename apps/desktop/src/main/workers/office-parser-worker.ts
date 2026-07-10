import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { extractOfficeText } from "../services/office-parser-core";
import type { OfficeParserRequest, OfficeParserWorkerResponse } from "../services/office-parser-types";

if (!parentPort) {
  throw new Error("Office parser worker must run in a worker thread.");
}
const workerPort = parentPort;

workerPort.on("message", (request: OfficeParserRequest) => {
  void extractOfficeText(request)
    .then((result) => {
      const response: OfficeParserWorkerResponse = { requestId: request.requestId, ok: true, result };
      workerPort.postMessage(response);
    })
    .catch((caught: unknown) => {
      const error = caught instanceof PigeDomainError
        ? caught
        : new PigeDomainError("parser.office.failed", "Office text extraction failed.");
      const response: OfficeParserWorkerResponse = {
        requestId: request.requestId,
        ok: false,
        error: { code: error.code, message: error.message }
      };
      workerPort.postMessage(response);
    });
});
