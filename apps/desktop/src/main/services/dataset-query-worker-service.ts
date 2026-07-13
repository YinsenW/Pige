import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { DATASET_QUERY_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/dataset-query-worker";
import {
  DATASET_QUERY_DEFAULT_LIMITS,
  DATASET_QUERY_PROTOCOL_VERSION,
  type DatasetQueryCoreResult,
  type DatasetQueryExecutor,
  type DatasetQueryWorkerInput,
  type DatasetQueryWorkerRequest,
  type DatasetQueryWorkerResponse
} from "./dataset-query-types";

export class DatasetQueryWorkerService implements DatasetQueryExecutor {
  readonly #workerUrl: URL;
  readonly #timeoutMs: number;
  readonly #workerOldGenerationMb: number;

  constructor(
    workerUrl = new URL(DATASET_QUERY_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = DATASET_QUERY_DEFAULT_LIMITS.timeoutMs,
    workerOldGenerationMb = DATASET_QUERY_DEFAULT_LIMITS.workerOldGenerationMb
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#workerOldGenerationMb = workerOldGenerationMb;
  }

  execute(input: DatasetQueryWorkerInput, signal?: AbortSignal): Promise<DatasetQueryCoreResult> {
    if (signal?.aborted) return Promise.reject(abortedError());
    const request: DatasetQueryWorkerRequest = {
      ...input,
      schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
      requestId: randomUUID()
    };
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-dataset-query",
        resourceLimits: { maxOldGenerationSizeMb: this.#workerOldGenerationMb }
      });
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        void worker.terminate().then(callback, callback);
      };
      const onAbort = (): void => finish(() => reject(abortedError()));
      timeout = setTimeout(() => finish(() => reject(new PigeDomainError(
        "dataset.query.timeout",
        "The bounded local Dataset query exceeded its time limit."
      ))), this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message: unknown) => {
        if (!isWorkerResponse(message, request.requestId)) {
          finish(() => reject(new PigeDomainError(
            "dataset.query.worker_protocol",
            "The Dataset query worker returned an invalid response."
          )));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => finish(() => reject(new PigeDomainError(
        "dataset.query.worker_failed",
        "The bounded local Dataset query worker failed."
      ))));
      worker.once("exit", () => {
        if (!settled) {
          finish(() => reject(new PigeDomainError(
            "dataset.query.worker_failed",
            "The Dataset query worker exited before returning a result."
          )));
        }
      });
      try {
        worker.postMessage(request);
      } catch {
        finish(() => reject(new PigeDomainError(
          "dataset.query.worker_protocol",
          "The Dataset query worker request could not be transferred safely."
        )));
      }
    });
  }
}

function isWorkerResponse(value: unknown, requestId: string): value is DatasetQueryWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  if (
    response.schemaVersion !== DATASET_QUERY_PROTOCOL_VERSION ||
    response.requestId !== requestId ||
    typeof response.ok !== "boolean"
  ) return false;
  if (response.ok === true) return typeof response.result === "object" && response.result !== null;
  if (typeof response.error !== "object" || response.error === null) return false;
  const error = response.error as Record<string, unknown>;
  return typeof error.code === "string" &&
    error.code.startsWith("dataset.query.") &&
    typeof error.message === "string";
}

function abortedError(): PigeDomainError {
  return new PigeDomainError("dataset.query.aborted", "The bounded local Dataset query was canceled.");
}
