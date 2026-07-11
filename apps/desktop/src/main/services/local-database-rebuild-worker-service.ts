import { randomUUID } from "node:crypto";
import path from "node:path";
import { Worker, type WorkerOptions } from "node:worker_threads";
import type { LocalDatabaseRebuildResult } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { LOCAL_DATABASE_REBUILD_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/local-database-rebuild-entry";
import { JobCancellationError } from "./job-execution-control";
import {
  LOCAL_DATABASE_REBUILD_ERROR_MESSAGES,
  LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
  LOCAL_DATABASE_REBUILD_TIMEOUT_MS,
  LOCAL_DATABASE_REBUILD_WORKER_OLD_GENERATION_MB,
  type LocalDatabaseRebuildErrorCode,
  type LocalDatabaseRebuildExecutionOptions,
  type LocalDatabaseRebuildPort,
  type LocalDatabaseRebuildProgress,
  type LocalDatabaseRebuildWorkerFailure,
  type LocalDatabaseRebuildWorkerRequest,
  type LocalDatabaseRebuildWorkerResponse
} from "./local-database-rebuild-types";

const WORKER_ERROR_CODES = new Set<LocalDatabaseRebuildErrorCode>(
  Object.keys(LOCAL_DATABASE_REBUILD_ERROR_MESSAGES) as LocalDatabaseRebuildErrorCode[]
);

export interface LocalDatabaseRebuildWorkerPort {
  on(event: "message", listener: (value: unknown) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  postMessage(value: LocalDatabaseRebuildWorkerRequest): void;
  terminate(): Promise<number>;
}

export type LocalDatabaseRebuildWorkerFactory = (
  workerUrl: URL,
  options: WorkerOptions
) => LocalDatabaseRebuildWorkerPort;

export interface LocalDatabaseRebuildWorkerServiceOptions {
  readonly workerUrl?: URL;
  readonly timeoutMs?: number;
  readonly workerFactory?: LocalDatabaseRebuildWorkerFactory;
}

export class LocalDatabaseRebuildWorkerService implements LocalDatabaseRebuildPort {
  readonly #timeoutMs: number;
  readonly #workerFactory: LocalDatabaseRebuildWorkerFactory;
  readonly #workerUrl: URL;

  constructor(options: LocalDatabaseRebuildWorkerServiceOptions = {}) {
    this.#workerUrl = options.workerUrl ?? new URL(
      LOCAL_DATABASE_REBUILD_WORKER_ENTRY_RELATIVE_PATH,
      import.meta.url
    );
    this.#timeoutMs = options.timeoutMs ?? LOCAL_DATABASE_REBUILD_TIMEOUT_MS;
    this.#workerFactory = options.workerFactory ?? ((workerUrl, workerOptions) =>
      new Worker(workerUrl, workerOptions));
  }

  rebuild(
    vaultPath: string,
    options: LocalDatabaseRebuildExecutionOptions = {}
  ): Promise<LocalDatabaseRebuildResult> {
    if (options.signal?.aborted) return Promise.reject(new JobCancellationError());
    if (!isValidVaultPath(vaultPath)) {
      return Promise.reject(rebuildError("database.index_rebuild.invalid_request"));
    }

    const request: LocalDatabaseRebuildWorkerRequest = {
      protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
      requestId: randomUUID(),
      vaultPath
    };
    let worker: LocalDatabaseRebuildWorkerPort;
    try {
      worker = this.#workerFactory(this.#workerUrl, {
        name: "pige-local-database-rebuild",
        resourceLimits: { maxOldGenerationSizeMb: LOCAL_DATABASE_REBUILD_WORKER_OLD_GENERATION_MB }
      });
    } catch {
      return Promise.reject(rebuildError("database.index_rebuild.worker_failed"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let lastProgress: LocalDatabaseRebuildProgress | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        void worker.terminate().then(callback, callback);
      };
      const onAbort = (): void => finish(() => reject(new JobCancellationError()));

      timeout = setTimeout(() => {
        finish(() => reject(rebuildError("database.index_rebuild.timeout")));
      }, this.#timeoutMs);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      worker.on("message", (value) => {
        if (settled) return;
        let response: LocalDatabaseRebuildWorkerResponse;
        try {
          response = parseWorkerResponse(value, request, lastProgress);
        } catch {
          finish(() => reject(rebuildError("database.index_rebuild.worker_protocol")));
          return;
        }
        if (response.kind === "progress") {
          try {
            options.onProgress?.(response.progress);
            lastProgress = response.progress;
          } catch (caught) {
            finish(() => reject(caught));
          }
          return;
        }
        if (response.kind === "failure") {
          finish(() => reject(rebuildError(response.error.code)));
          return;
        }
        finish(() => resolve(response.result));
      });
      worker.once("error", () => {
        finish(() => reject(rebuildError("database.index_rebuild.worker_failed")));
      });
      worker.once("exit", () => {
        if (!settled) finish(() => reject(rebuildError("database.index_rebuild.worker_failed")));
      });

      try {
        worker.postMessage(request);
      } catch {
        finish(() => reject(rebuildError("database.index_rebuild.worker_failed")));
      }
    });
  }
}

function parseWorkerResponse(
  value: unknown,
  request: LocalDatabaseRebuildWorkerRequest,
  previousProgress: LocalDatabaseRebuildProgress | undefined
): LocalDatabaseRebuildWorkerResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION ||
    value.requestId !== request.requestId ||
    typeof value.kind !== "string"
  ) {
    throw new Error("invalid envelope");
  }
  if (value.kind === "progress") {
    if (!hasExactKeys(value, ["protocolVersion", "requestId", "kind", "progress"])) {
      throw new Error("invalid progress envelope");
    }
    return {
      protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
      requestId: request.requestId,
      kind: "progress",
      progress: parseProgress(value.progress, previousProgress)
    };
  }
  if (value.kind === "failure") return parseWorkerFailure(value, request.requestId);
  if (value.kind !== "success" || !hasExactKeys(value, ["protocolVersion", "requestId", "kind", "result"])) {
    throw new Error("invalid result envelope");
  }
  const result = parseRebuildResult(value.result);
  const expectedTotalUnits = Math.max(1, (result.pageCount * 2) + 1);
  if (
    !previousProgress ||
    previousProgress.completedUnits !== previousProgress.totalUnits ||
    previousProgress.totalUnits !== expectedTotalUnits
  ) {
    throw new Error("incomplete result progress");
  }
  return {
    protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
    requestId: request.requestId,
    kind: "success",
    result
  };
}

function parseProgress(value: unknown, previous: LocalDatabaseRebuildProgress | undefined): LocalDatabaseRebuildProgress {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["completedUnits", "totalUnits", "unit"]) ||
    !Number.isSafeInteger(value.completedUnits) ||
    !Number.isSafeInteger(value.totalUnits) ||
    Number(value.completedUnits) < 0 ||
    Number(value.totalUnits) <= 0 ||
    Number(value.completedUnits) > Number(value.totalUnits) ||
    value.unit !== "index_item"
  ) {
    throw new Error("invalid progress");
  }
  const progress: LocalDatabaseRebuildProgress = {
    completedUnits: Number(value.completedUnits),
    totalUnits: Number(value.totalUnits),
    unit: "index_item"
  };
  if (
    previous &&
    (progress.completedUnits < previous.completedUnits || progress.totalUnits !== previous.totalUnits)
  ) {
    throw new Error("non-monotonic progress");
  }
  return progress;
}

function parseRebuildResult(value: unknown): LocalDatabaseRebuildResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["rebuiltAt", "pageCount", "invalidPageCount"]) ||
    typeof value.rebuiltAt !== "string" ||
    !Number.isFinite(Date.parse(value.rebuiltAt)) ||
    !Number.isSafeInteger(value.pageCount) ||
    Number(value.pageCount) < 0 ||
    !Number.isSafeInteger(value.invalidPageCount) ||
    Number(value.invalidPageCount) < 0
  ) {
    throw new Error("invalid rebuild result");
  }
  return {
    rebuiltAt: value.rebuiltAt,
    pageCount: Number(value.pageCount),
    invalidPageCount: Number(value.invalidPageCount)
  };
}

function parseWorkerFailure(value: Record<string, unknown>, requestId: string): LocalDatabaseRebuildWorkerFailure {
  if (!hasExactKeys(value, ["protocolVersion", "requestId", "kind", "error"]) || !isRecord(value.error)) {
    throw new Error("invalid failure envelope");
  }
  const error = value.error;
  if (
    !hasExactKeys(error, ["code", "message"]) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    !WORKER_ERROR_CODES.has(error.code as LocalDatabaseRebuildErrorCode) ||
    error.message !== LOCAL_DATABASE_REBUILD_ERROR_MESSAGES[error.code as LocalDatabaseRebuildErrorCode]
  ) {
    throw new Error("invalid worker error");
  }
  return {
    protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
    requestId,
    kind: "failure",
    error: {
      code: error.code as LocalDatabaseRebuildErrorCode,
      message: error.message
    }
  };
}

function rebuildError(code: LocalDatabaseRebuildErrorCode): PigeDomainError {
  return new PigeDomainError(code, LOCAL_DATABASE_REBUILD_ERROR_MESSAGES[code]);
}

function isValidVaultPath(value: string): boolean {
  return value.length > 0 && value.length <= 32_768 && !value.includes("\u0000") && path.isAbsolute(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
