import type { LocalDatabaseRebuildResult } from "@pige/contracts";

export const LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION = 1;
export const LOCAL_DATABASE_REBUILD_TIMEOUT_MS = 15 * 60_000;
export const LOCAL_DATABASE_REBUILD_WORKER_OLD_GENERATION_MB = 512;

export const LOCAL_DATABASE_REBUILD_ERROR_MESSAGES = {
  "database.index_rebuild.invalid_request": "The local index rebuild request is invalid.",
  "database.index_rebuild.worker_failed": "The local index rebuild worker failed.",
  "database.index_rebuild.worker_protocol": "The local index rebuild worker returned an invalid response.",
  "database.index_rebuild.timeout": "The local index rebuild exceeded its time limit.",
  "database.index_rebuild.failed": "The local index rebuild failed."
} as const;

export type LocalDatabaseRebuildErrorCode = keyof typeof LOCAL_DATABASE_REBUILD_ERROR_MESSAGES;

export interface LocalDatabaseRebuildProgress {
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly unit: "index_item";
}

export interface LocalDatabaseRebuildExecutionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: LocalDatabaseRebuildProgress) => void;
}

export interface LocalDatabaseRebuildPort {
  rebuild(
    vaultPath: string,
    options?: LocalDatabaseRebuildExecutionOptions
  ): Promise<LocalDatabaseRebuildResult>;
}

export interface LocalDatabaseRebuildWorkerRequest {
  readonly protocolVersion: typeof LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly vaultPath: string;
}

export interface LocalDatabaseRebuildWorkerProgress {
  readonly protocolVersion: typeof LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "progress";
  readonly progress: LocalDatabaseRebuildProgress;
}

export interface LocalDatabaseRebuildWorkerSuccess {
  readonly protocolVersion: typeof LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "success";
  readonly result: LocalDatabaseRebuildResult;
}

export interface LocalDatabaseRebuildWorkerFailure {
  readonly protocolVersion: typeof LOCAL_DATABASE_REBUILD_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly kind: "failure";
  readonly error: {
    readonly code: LocalDatabaseRebuildErrorCode;
    readonly message: string;
  };
}

export type LocalDatabaseRebuildWorkerResponse =
  | LocalDatabaseRebuildWorkerProgress
  | LocalDatabaseRebuildWorkerSuccess
  | LocalDatabaseRebuildWorkerFailure;
