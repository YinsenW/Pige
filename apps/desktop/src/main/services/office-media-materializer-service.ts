import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/office-parser-entry";
import { JobCancellationError } from "./job-execution-control";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_MEDIA_MATERIALIZER_TIMEOUT_MS,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  type OfficeMediaMaterializerRequest,
  type OfficeMediaMaterializerResult,
  type OfficeMediaTarget,
  type OfficeMediaWorkerResponse
} from "./office-parser-types";

export interface OfficeMediaMaterializerPort {
  isAvailable(): boolean;
  materialize(
    filePath: string,
    targets: readonly OfficeMediaTarget[],
    signal?: AbortSignal
  ): Promise<OfficeMediaMaterializerResult>;
}

export class OfficeMediaMaterializerWorkerAdapter implements OfficeMediaMaterializerPort {
  readonly #timeoutMs: number;
  readonly #workerUrl: URL;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    workerUrl = new URL(OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = OFFICE_MEDIA_MATERIALIZER_TIMEOUT_MS,
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#resolveModule = resolveModule;
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("mammoth/package.json") &&
        this.#resolveModule("fast-xml-parser/package.json") &&
        this.#resolveModule("yauzl/package.json")
      );
    } catch {
      return false;
    }
  }

  materialize(
    filePath: string,
    targets: readonly OfficeMediaTarget[],
    signal?: AbortSignal
  ): Promise<OfficeMediaMaterializerResult> {
    if (signal?.aborted) return Promise.reject(new JobCancellationError());
    const request: OfficeMediaMaterializerRequest = {
      operation: "materialize_pptx_media",
      requestId: randomUUID(),
      filePath,
      sourceKind: "pptx_file",
      targets,
      limits: {
        maxBytes: OFFICE_PARSER_MAX_BYTES,
        maxEntries: OFFICE_PARSER_MAX_ENTRIES,
        maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
        maxTargets: OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
        maxBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
        maxTotalBytes: OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES
      }
    };
    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-office-media-materializer",
        resourceLimits: { maxOldGenerationSizeMb: 512 }
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
      const onAbort = (): void => {
        finish(() => reject(new JobCancellationError()));
      };
      timeout = setTimeout(() => {
        finish(() => reject(new PigeDomainError("ocr.pptx.materializer_timeout", "PPTX media materialization exceeded the local time limit.")));
      }, this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message: OfficeMediaWorkerResponse) => {
        if (!message || message.operation !== request.operation || message.requestId !== request.requestId) {
          finish(() => reject(new PigeDomainError("ocr.pptx.worker_protocol", "The Office media worker returned an invalid response.")));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => {
        finish(() => reject(new PigeDomainError("ocr.pptx.worker_failed", "The Office media worker failed.")));
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          finish(() => reject(new PigeDomainError("ocr.pptx.worker_failed", "The Office media worker exited before completing.")));
        }
      });
      worker.postMessage(request);
    });
  }
}
