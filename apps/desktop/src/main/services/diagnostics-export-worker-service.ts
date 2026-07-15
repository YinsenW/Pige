import { randomUUID } from "node:crypto";
import { Worker, type WorkerOptions } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { DIAGNOSTICS_EXPORT_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/diagnostics-export-entry";
import {
  assertSafeDiagnosticExportText,
  prepareDiagnosticsExportFile,
  releasePreparedDiagnosticsExportFile,
  reconcileDiagnosticsExportFile
} from "./diagnostics-export-core";
import {
  DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
  DIAGNOSTICS_EXPORT_TIMEOUT_MS,
  DIAGNOSTICS_EXPORT_WORKER_OLD_GENERATION_MB,
  type DiagnosticsExportPort,
  type DiagnosticsExportWorkerRequest,
  type DiagnosticsExportWorkerResponse,
  type DiagnosticsExportWriteOptions,
  type DiagnosticsExportWriteRequest
} from "./diagnostics-export-types";

interface DiagnosticsExportWorkerPort {
  on(event: "message", listener: (value: unknown) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  postMessage(value: DiagnosticsExportWorkerRequest): void;
  terminate(): Promise<number>;
}

export type DiagnosticsExportWorkerFactory = (
  workerUrl: URL,
  options: WorkerOptions
) => DiagnosticsExportWorkerPort;

export interface DiagnosticsExportWorkerServiceOptions {
  readonly workerUrl?: URL;
  readonly timeoutMs?: number;
  readonly workerFactory?: DiagnosticsExportWorkerFactory;
}

export class DiagnosticsExportWorkerService implements DiagnosticsExportPort {
  readonly #workerUrl: URL;
  readonly #timeoutMs: number;
  readonly #workerFactory: DiagnosticsExportWorkerFactory;

  constructor(options: DiagnosticsExportWorkerServiceOptions = {}) {
    this.#workerUrl = options.workerUrl ?? new URL(
      DIAGNOSTICS_EXPORT_WORKER_ENTRY_RELATIVE_PATH,
      import.meta.url
    );
    this.#timeoutMs = options.timeoutMs ?? DIAGNOSTICS_EXPORT_TIMEOUT_MS;
    this.#workerFactory = options.workerFactory ?? ((workerUrl, workerOptions) =>
      new Worker(workerUrl, workerOptions));
  }

  write(
    request: DiagnosticsExportWriteRequest,
    options: DiagnosticsExportWriteOptions = {}
  ): Promise<{ readonly bytesWritten: number }> {
    if (options.signal?.aborted) return Promise.reject(exportError("diagnostics.export_canceled"));
    try {
      assertSafeDiagnosticExportText(request.content);
    } catch {
      return Promise.reject(exportError("diagnostics.export_blocked"));
    }
    const requestId = randomUUID();
    let prepared: DiagnosticsExportWorkerRequest["prepared"];
    try {
      prepared = prepareDiagnosticsExportFile(request.outputPath, requestId);
    } catch {
      return Promise.reject(exportError("diagnostics.export_failed"));
    }
    const workerRequest: DiagnosticsExportWorkerRequest = {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId,
      outputPath: request.outputPath,
      content: request.content,
      prepared
    };
    let worker: DiagnosticsExportWorkerPort;
    try {
      worker = this.#workerFactory(this.#workerUrl, {
        name: "pige-diagnostics-export",
        resourceLimits: { maxOldGenerationSizeMb: DIAGNOSTICS_EXPORT_WORKER_OLD_GENERATION_MB }
      });
    } catch {
      releasePreparedDiagnosticsExportFile(workerRequest.prepared);
      return Promise.reject(exportError("diagnostics.export_failed"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expectedBytes = Buffer.byteLength(request.content);
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
        void worker.terminate().then(() => {
          try {
            callback();
          } finally {
            releasePreparedDiagnosticsExportFile(workerRequest.prepared);
          }
        }, () => {
          try {
            callback();
          } finally {
            releasePreparedDiagnosticsExportFile(workerRequest.prepared);
          }
        });
      };
      const reconcileOrReject = (code: string): void => finish(() => {
        const committed = reconcileDiagnosticsExportFile(request.outputPath, request.content);
        if (committed) resolve(committed);
        else reject(exportError(code));
      });
      const onAbort = (): void => reconcileOrReject("diagnostics.export_canceled");

      timeout = setTimeout(() => {
        reconcileOrReject("diagnostics.export_timeout");
      }, this.#timeoutMs);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }

      worker.on("message", (value) => {
        if (settled) return;
        let response: DiagnosticsExportWorkerResponse;
        try {
          response = parseResponse(value, workerRequest.requestId, expectedBytes);
        } catch {
          finish(() => reject(exportError("diagnostics.export_worker_protocol")));
          return;
        }
        if (response.kind === "failure") {
          if (response.code === "diagnostics.export_failed") reconcileOrReject(response.code);
          else finish(() => reject(exportError(response.code)));
          return;
        }
        finish(() => {
          const committed = reconcileDiagnosticsExportFile(request.outputPath, request.content);
          if (committed?.bytesWritten === response.bytesWritten) resolve(committed);
          else reject(exportError("diagnostics.export_failed"));
        });
      });
      worker.once("error", () => reconcileOrReject("diagnostics.export_failed"));
      worker.once("exit", () => {
        if (!settled) reconcileOrReject("diagnostics.export_failed");
      });
      try {
        worker.postMessage(workerRequest);
      } catch {
        reconcileOrReject("diagnostics.export_failed");
      }
    });
  }
}

function parseResponse(
  value: unknown,
  requestId: string,
  expectedBytes: number
): DiagnosticsExportWorkerResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== DIAGNOSTICS_EXPORT_PROTOCOL_VERSION ||
    value.requestId !== requestId ||
    (value.kind !== "success" && value.kind !== "failure")
  ) {
    throw new Error("invalid diagnostics export worker response");
  }
  if (value.kind === "success") {
    if (!hasExactKeys(value, ["protocolVersion", "requestId", "kind", "bytesWritten"]) ||
      !Number.isSafeInteger(value.bytesWritten) || Number(value.bytesWritten) !== expectedBytes) {
      throw new Error("invalid diagnostics export success response");
    }
    return {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId,
      kind: "success",
      bytesWritten: Number(value.bytesWritten)
    };
  }
  if (!hasExactKeys(value, ["protocolVersion", "requestId", "kind", "code"]) ||
    (value.code !== "diagnostics.export_blocked" && value.code !== "diagnostics.export_failed")) {
    throw new Error("invalid diagnostics export failure response");
  }
  return {
    protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
    requestId,
    kind: "failure",
    code: value.code
  };
}

function exportError(code: string): PigeDomainError {
  return new PigeDomainError(code, "The support bundle could not be exported safely.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
