import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { materializeOfficeMedia } from "../services/office-media-materializer-core";
import { extractOfficeText } from "../services/office-parser-core";
import type {
  OfficeMediaMaterializerRequest,
  OfficeMediaWorkerResponse,
  OfficeParserRequest,
  OfficeParserWorkerResponse,
  OfficeWorkerRequest
} from "../services/office-parser-types";

if (!parentPort) {
  throw new Error("Office parser worker must run in a worker thread.");
}
const workerPort = parentPort;

workerPort.on("message", (request: OfficeWorkerRequest) => {
  if (isMediaRequest(request)) {
    void materializeOfficeMedia(request)
      .then((result) => {
        const response: OfficeMediaWorkerResponse = {
          operation: request.operation,
          requestId: request.requestId,
          ok: true,
          result
        };
        workerPort.postMessage(response);
      })
      .catch((caught: unknown) => {
        const error = caught instanceof PigeDomainError
          ? caught
          : new PigeDomainError("ocr.pptx.materializer_failed", "PPTX media materialization failed.");
        const response: OfficeMediaWorkerResponse = {
          operation: request.operation,
          requestId: request.requestId,
          ok: false,
          error: { code: error.code, message: error.message }
        };
        workerPort.postMessage(response);
      });
    return;
  }
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

function isMediaRequest(request: OfficeWorkerRequest): request is OfficeMediaMaterializerRequest {
  return "operation" in request && request.operation === "materialize_pptx_media";
}
