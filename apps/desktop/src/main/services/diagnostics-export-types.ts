export const DIAGNOSTICS_EXPORT_PROTOCOL_VERSION = 1;
export const DIAGNOSTICS_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DIAGNOSTICS_EXPORT_TIMEOUT_MS = 30_000;
export const DIAGNOSTICS_EXPORT_WORKER_OLD_GENERATION_MB = 64;

export interface DiagnosticsExportWorkerRequest {
  readonly protocolVersion: typeof DIAGNOSTICS_EXPORT_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly outputPath: string;
  readonly content: string;
  readonly prepared: {
    readonly outputPath: string;
    readonly destination: string;
    readonly parentRealPath: string;
    readonly parentDevice: number;
    readonly parentInode: number;
    readonly destinationBinding:
      | { readonly kind: "absent" }
      | {
          readonly kind: "held_descriptor";
          readonly descriptor: number;
          readonly device: number;
          readonly inode: number;
        }
      | {
          readonly kind: "content_digest";
          readonly device: number;
          readonly inode: number;
          readonly size: number;
          readonly modifiedAtMs: number;
          readonly changedAtMs: number;
          readonly sha256: string;
        };
    readonly temporaryPath: string;
    readonly temporaryDescriptor: number;
    readonly temporaryDevice: number;
    readonly temporaryInode: number;
  };
}

export interface DiagnosticsExportWorkerSuccess {
  readonly protocolVersion: typeof DIAGNOSTICS_EXPORT_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "success";
  readonly bytesWritten: number;
}

export interface DiagnosticsExportWorkerFailure {
  readonly protocolVersion: typeof DIAGNOSTICS_EXPORT_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "failure";
  readonly code: "diagnostics.export_blocked" | "diagnostics.export_failed";
}

export type DiagnosticsExportWorkerResponse =
  | DiagnosticsExportWorkerSuccess
  | DiagnosticsExportWorkerFailure;

export interface DiagnosticsExportWriteRequest {
  readonly outputPath: string;
  readonly content: string;
}

export interface DiagnosticsExportWriteOptions {
  readonly signal?: AbortSignal;
}

export interface DiagnosticsExportPort {
  write(
    request: DiagnosticsExportWriteRequest,
    options?: DiagnosticsExportWriteOptions
  ): Promise<{ readonly bytesWritten: number }>;
}
