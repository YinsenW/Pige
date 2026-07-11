import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import type { WorkerOptions } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import {
  LocalDatabaseRebuildWorkerService,
  type LocalDatabaseRebuildWorkerPort
} from "../../apps/desktop/src/main/services/local-database-rebuild-worker-service";
import {
  LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
  LOCAL_DATABASE_REBUILD_WORKER_OLD_GENERATION_MB,
  type LocalDatabaseRebuildWorkerRequest
} from "../../apps/desktop/src/main/services/local-database-rebuild-types";

describe("local database rebuild worker service", () => {
  it("validates monotonic worker progress and returns the bounded rebuild result", async () => {
    const progress = vi.fn();
    const workers: FakeWorker[] = [];
    let workerOptions: WorkerOptions | undefined;
    const service = serviceWithWorker((request, worker) => {
      queueMicrotask(() => {
        worker.emit("message", progressMessage(request, 0, 3));
        worker.emit("message", progressMessage(request, 1, 3));
        worker.emit("message", progressMessage(request, 3, 3));
        worker.emit("message", {
          protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
          requestId: request.requestId,
          kind: "success",
          result: {
            rebuiltAt: "2026-07-11T00:00:00.000Z",
            pageCount: 1,
            invalidPageCount: 0
          }
        });
      });
    }, workers, (options) => {
      workerOptions = options;
    });

    const result = await service.rebuild(vaultPath(), { onProgress: progress });

    expect(result).toEqual({
      rebuiltAt: "2026-07-11T00:00:00.000Z",
      pageCount: 1,
      invalidPageCount: 0
    });
    expect(progress.mock.calls.map(([value]) => value.completedUnits)).toEqual([0, 1, 3]);
    expect(workerOptions).toMatchObject({
      name: "pige-local-database-rebuild",
      resourceLimits: { maxOldGenerationSizeMb: LOCAL_DATABASE_REBUILD_WORKER_OLD_GENERATION_MB }
    });
    expect(workers[0]?.terminateCalls).toBe(1);
  });

  it("fails closed on a non-monotonic or undeclared worker response", async () => {
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker((request, worker) => {
      queueMicrotask(() => {
        worker.emit("message", progressMessage(request, 2, 3));
        worker.emit("message", {
          ...progressMessage(request, 1, 3),
          leakedPath: "/private/index.sqlite"
        });
      });
    }, workers);

    await expect(service.rebuild(vaultPath())).rejects.toMatchObject({
      code: "database.index_rebuild.worker_protocol"
    });
    expect(workers[0]?.terminateCalls).toBe(1);
  });

  it("terminates the worker through the shared cancellation signal", async () => {
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker(() => undefined, workers);
    const controller = new AbortController();
    const progress = vi.fn();

    const rebuilding = service.rebuild(vaultPath(), {
      signal: controller.signal,
      onProgress: progress
    });
    controller.abort();
    const request = workers[0]?.lastRequest;
    if (request) workers[0]?.emit("message", progressMessage(request, 1, 1));

    await expect(rebuilding).rejects.toBeInstanceOf(JobCancellationError);
    expect(progress).not.toHaveBeenCalled();
    expect(workers[0]?.terminateCalls).toBe(1);
  });

  it("terminates a worker that exceeds the bounded execution time", async () => {
    const workers: FakeWorker[] = [];
    const service = serviceWithWorker(() => undefined, workers, undefined, 5);

    await expect(service.rebuild(vaultPath())).rejects.toMatchObject({
      code: "database.index_rebuild.timeout"
    });
    expect(workers[0]?.terminateCalls).toBe(1);
  });
});

type WorkerHandler = (request: LocalDatabaseRebuildWorkerRequest, worker: FakeWorker) => void;

class FakeWorker extends EventEmitter implements LocalDatabaseRebuildWorkerPort {
  readonly #handler: WorkerHandler;
  lastRequest: LocalDatabaseRebuildWorkerRequest | undefined;
  terminateCalls = 0;

  constructor(handler: WorkerHandler) {
    super();
    this.#handler = handler;
  }

  postMessage(value: LocalDatabaseRebuildWorkerRequest): void {
    this.lastRequest = value;
    this.#handler(value, this);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    return Promise.resolve(0);
  }
}

function serviceWithWorker(
  handler: WorkerHandler,
  workers: FakeWorker[],
  captureOptions?: (options: WorkerOptions) => void,
  timeoutMs = 10_000
): LocalDatabaseRebuildWorkerService {
  return new LocalDatabaseRebuildWorkerService({
    timeoutMs,
    workerFactory: (_workerUrl, options) => {
      captureOptions?.(options);
      const worker = new FakeWorker(handler);
      workers.push(worker);
      return worker;
    }
  });
}

function progressMessage(request: LocalDatabaseRebuildWorkerRequest, completedUnits: number, totalUnits: number) {
  return {
    protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
    requestId: request.requestId,
    kind: "progress",
    progress: { completedUnits, totalUnits, unit: "index_item" }
  };
}

function vaultPath(): string {
  return path.join(os.tmpdir(), "pige-index-worker-vault");
}
