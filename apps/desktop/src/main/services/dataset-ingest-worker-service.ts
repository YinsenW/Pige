import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { DATASET_INGEST_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/dataset-ingest-worker";
import type { DatasetImportPlanner } from "./dataset-service";
import {
  DATASET_INGEST_DEFAULT_LIMITS,
  type DatasetIngestPlan,
  type DatasetIngestRequest,
  type DatasetIngestSourceKind,
  type DatasetIngestWorkerResponse
} from "./dataset-ingest-types";
import { JobCancellationError } from "./job-execution-control";

const DATASET_INGEST_TIMEOUT_MS = 180_000;

export class DatasetIngestWorkerService implements DatasetImportPlanner {
  readonly #workerUrl: URL;
  readonly #timeoutMs: number;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    workerUrl = new URL(DATASET_INGEST_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = DATASET_INGEST_TIMEOUT_MS,
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#resolveModule = resolveModule;
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("fast-xml-parser") &&
        this.#resolveModule("yauzl/package.json")
      );
    } catch {
      return false;
    }
  }

  plan(
    filePath: string,
    sourceKind: DatasetIngestSourceKind,
    signal?: AbortSignal
  ): Promise<DatasetIngestPlan> {
    if (signal?.aborted) return Promise.reject(new JobCancellationError());
    const request: DatasetIngestRequest = {
      requestId: randomUUID(),
      filePath,
      sourceKind,
      limits: { ...DATASET_INGEST_DEFAULT_LIMITS }
    };
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-dataset-ingest",
        resourceLimits: { maxOldGenerationSizeMb: 768 }
      });
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        void worker.terminate();
        callback();
      };
      const onAbort = (): void => finish(() => reject(new JobCancellationError()));
      timeout = setTimeout(() => finish(() => reject(new PigeDomainError(
        "dataset.ingest.timeout",
        "Dataset import planning exceeded the local time limit."
      ))), this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message: DatasetIngestWorkerResponse) => {
        if (!message || message.requestId !== request.requestId) {
          finish(() => reject(new PigeDomainError(
            "dataset.ingest.worker_protocol",
            "The Dataset worker returned an invalid response."
          )));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.plan));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => finish(() => reject(new PigeDomainError(
        "dataset.ingest.worker_failed",
        "The Dataset worker failed."
      ))));
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          finish(() => reject(new PigeDomainError(
            "dataset.ingest.worker_failed",
            "The Dataset worker exited before completing."
          )));
        }
      });
      worker.postMessage(request);
    });
  }
}
