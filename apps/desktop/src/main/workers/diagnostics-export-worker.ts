import path from "node:path";
import { parentPort } from "node:worker_threads";
import {
  commitPreparedDiagnosticsExportFile,
  DiagnosticsExportBlockedError,
  type PreparedDiagnosticsExportFile
} from "../services/diagnostics-export-core";
import {
  DIAGNOSTICS_EXPORT_MAX_BYTES,
  DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
  type DiagnosticsExportWorkerFailure,
  type DiagnosticsExportWorkerRequest,
  type DiagnosticsExportWorkerResponse
} from "../services/diagnostics-export-types";

if (!parentPort) throw new Error("Diagnostics export worker must run in a worker thread.");
const workerPort = parentPort;

workerPort.on("message", (value: unknown) => {
  const request = parseRequest(value);
  if (!request) return;
  try {
    const bytesWritten = commitPreparedDiagnosticsExportFile(request.prepared, request.content);
    const response: DiagnosticsExportWorkerResponse = {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId: request.requestId,
      kind: "success",
      bytesWritten
    };
    workerPort.postMessage(response);
  } catch (caught) {
    const response: DiagnosticsExportWorkerFailure = {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId: request.requestId,
      kind: "failure",
      code: caught instanceof DiagnosticsExportBlockedError
        ? "diagnostics.export_blocked"
        : "diagnostics.export_failed"
    };
    workerPort.postMessage(response);
  }
});

function parseRequest(value: unknown): DiagnosticsExportWorkerRequest | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["protocolVersion", "requestId", "outputPath", "content", "prepared"]) ||
    value.protocolVersion !== DIAGNOSTICS_EXPORT_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !/^[a-f0-9-]{16,64}$/u.test(value.requestId) ||
    typeof value.outputPath !== "string" ||
    !path.isAbsolute(value.outputPath) ||
    value.outputPath.length === 0 ||
    value.outputPath.length > 32_768 ||
    value.outputPath.includes("\u0000") ||
    typeof value.content !== "string" ||
    Buffer.byteLength(value.content) === 0 ||
    Buffer.byteLength(value.content) > DIAGNOSTICS_EXPORT_MAX_BYTES ||
    !isPreparedExport(value.prepared, value.outputPath)
  ) {
    return undefined;
  }
  return {
    protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
    requestId: value.requestId,
    outputPath: value.outputPath,
    content: value.content,
    prepared: value.prepared
  };
}

function isPreparedExport(value: unknown, outputPath: string): value is PreparedDiagnosticsExportFile {
  if (!isRecord(value)) return false;
  const allowed = [
    "outputPath", "destination", "parentRealPath", "parentDevice", "parentInode",
    "destinationBinding", "temporaryPath", "temporaryDescriptor", "temporaryDevice", "temporaryInode"
  ];
  if (!hasExactKeys(value, allowed) || !isDestinationBinding(value.destinationBinding)) return false;
  return value.outputPath === outputPath &&
    typeof value.destination === "string" && path.isAbsolute(value.destination) &&
    typeof value.parentRealPath === "string" && path.isAbsolute(value.parentRealPath) &&
    typeof value.temporaryPath === "string" && path.isAbsolute(value.temporaryPath) &&
    value.temporaryPath.startsWith(`${value.parentRealPath}${path.sep}`) &&
    isNonNegativeInteger(value.parentDevice) && isNonNegativeInteger(value.parentInode) &&
    isNonNegativeSafeInteger(value.temporaryDescriptor) &&
    isNonNegativeInteger(value.temporaryDevice) && isNonNegativeInteger(value.temporaryInode);
}

function isDestinationBinding(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "absent") return hasExactKeys(value, ["kind"]);
  if (value.kind === "held_descriptor") {
    return hasExactKeys(value, ["kind", "descriptor", "device", "inode"]) &&
      isNonNegativeSafeInteger(value.descriptor) &&
      isNonNegativeInteger(value.device) &&
      isNonNegativeInteger(value.inode);
  }
  return value.kind === "content_digest" &&
    hasExactKeys(value, [
      "kind", "device", "inode", "size", "modifiedAtMs", "changedAtMs", "sha256"
    ]) &&
    isNonNegativeInteger(value.device) &&
    isNonNegativeInteger(value.inode) &&
    isNonNegativeSafeInteger(value.size) && value.size <= DIAGNOSTICS_EXPORT_MAX_BYTES &&
    isNonNegativeFinite(value.modifiedAtMs) && isNonNegativeFinite(value.changedAtMs) &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.sha256);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
