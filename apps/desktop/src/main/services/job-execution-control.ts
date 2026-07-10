export interface JobProgressUpdate {
  readonly completedUnits: number;
  readonly totalUnits?: number;
  readonly unit?: string;
  readonly messageKey?: string;
}

export interface JobCancellationBoundary {
  readonly durableWritesApplied?: boolean;
  readonly safeCheckpointId?: string;
}

export interface JobDurableWriteState {
  readonly durableWritesApplied: boolean;
  readonly safeCheckpointId?: string;
}

export interface JobExecutionControl {
  readonly signal: AbortSignal;
  throwIfCancellationRequested(boundary?: JobCancellationBoundary): void;
  reportProgress(progress: JobProgressUpdate, boundary?: JobCancellationBoundary): void;
  markDurableCheckpoint(checkpointId: string): void;
  durableWriteState(): JobDurableWriteState;
}

export class JobCancellationError extends Error {
  readonly durableWritesApplied: boolean;
  readonly safeCheckpointId?: string;

  constructor(boundary: JobCancellationBoundary = {}) {
    super("The durable job was cancelled at a cooperative checkpoint.");
    this.name = "JobCancellationError";
    this.durableWritesApplied = boundary.durableWritesApplied === true;
    if (boundary.safeCheckpointId) this.safeCheckpointId = boundary.safeCheckpointId;
  }
}
