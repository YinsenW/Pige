import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { planDatasetIngest } from "../services/dataset-ingest-core";
import type {
  DatasetIngestRequest,
  DatasetIngestWorkerResponse
} from "../services/dataset-ingest-types";

if (!parentPort) throw new Error("Dataset ingest worker must run in a worker thread.");
const workerPort = parentPort;

workerPort.on("message", (request: DatasetIngestRequest) => {
  void planDatasetIngest(request)
    .then((plan) => {
      const response: DatasetIngestWorkerResponse = {
        requestId: request.requestId,
        ok: true,
        plan
      };
      workerPort.postMessage(response);
    })
    .catch((caught: unknown) => {
      const error = caught instanceof PigeDomainError
        ? caught
        : new PigeDomainError("dataset.ingest.worker_failed", "Dataset import planning failed.");
      const response: DatasetIngestWorkerResponse = {
        requestId: request.requestId,
        ok: false,
        error: { code: error.code, message: error.message }
      };
      workerPort.postMessage(response);
    });
});
