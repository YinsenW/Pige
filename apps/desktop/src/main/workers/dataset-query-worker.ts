import { parentPort } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { executeDatasetQuery } from "../services/dataset-query-core";
import {
  DATASET_QUERY_PROTOCOL_VERSION,
  type DatasetQueryWorkerRequest,
  type DatasetQueryWorkerResponse
} from "../services/dataset-query-types";

if (!parentPort) throw new Error("Dataset query worker must run in a worker thread.");
const workerPort = parentPort;

workerPort.on("message", (request: DatasetQueryWorkerRequest) => {
  try {
    const response: DatasetQueryWorkerResponse = {
      schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: executeDatasetQuery(request)
    };
    workerPort.postMessage(response);
  } catch (caught) {
    const error = caught instanceof PigeDomainError && caught.code.startsWith("dataset.query.")
      ? caught
      : new PigeDomainError("dataset.query.worker_failed", "The bounded local Dataset query failed.");
    const response: DatasetQueryWorkerResponse = {
      schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
      requestId: typeof request?.requestId === "string" ? request.requestId : "invalid",
      ok: false,
      error: { code: error.code, message: error.message }
    };
    workerPort.postMessage(response);
  }
});
