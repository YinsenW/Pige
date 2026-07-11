import path from "node:path";
import { parentPort } from "node:worker_threads";
import { NodeSqliteDriver } from "../services/local-database-service";
import {
  LOCAL_DATABASE_REBUILD_ERROR_MESSAGES,
  LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
  type LocalDatabaseRebuildWorkerFailure,
  type LocalDatabaseRebuildWorkerRequest,
  type LocalDatabaseRebuildWorkerResponse
} from "../services/local-database-rebuild-types";

if (!parentPort) throw new Error("Local database rebuild worker must run in a worker thread.");
const workerPort = parentPort;

workerPort.on("message", (value: unknown) => {
  const request = parseRequest(value);
  if (!request) return;
  try {
    const result = new NodeSqliteDriver().rebuild(request.vaultPath, {
      onProgress: (progress) => {
        const response: LocalDatabaseRebuildWorkerResponse = {
          protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
          requestId: request.requestId,
          kind: "progress",
          progress
        };
        workerPort.postMessage(response);
      }
    });
    const response: LocalDatabaseRebuildWorkerResponse = {
      protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
      requestId: request.requestId,
      kind: "success",
      result
    };
    workerPort.postMessage(response);
  } catch {
    const response: LocalDatabaseRebuildWorkerFailure = {
      protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
      requestId: request.requestId,
      kind: "failure",
      error: {
        code: "database.index_rebuild.failed",
        message: LOCAL_DATABASE_REBUILD_ERROR_MESSAGES["database.index_rebuild.failed"]
      }
    };
    workerPort.postMessage(response);
  }
});

function parseRequest(value: unknown): LocalDatabaseRebuildWorkerRequest | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["protocolVersion", "requestId", "vaultPath"]) ||
    value.protocolVersion !== LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !/^[a-f0-9-]{16,64}$/u.test(value.requestId) ||
    typeof value.vaultPath !== "string" ||
    value.vaultPath.length === 0 ||
    value.vaultPath.length > 32_768 ||
    value.vaultPath.includes("\u0000") ||
    !path.isAbsolute(value.vaultPath)
  ) {
    return undefined;
  }
  return {
    protocolVersion: LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION,
    requestId: value.requestId,
    vaultPath: value.vaultPath
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
