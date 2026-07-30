import { PigeDomainError } from "@pige/domain";
import type { JobRecord } from "@pige/schemas";
import type { RestoreIdentityMode } from "./backup-service";
import type { RestoreJobStore } from "./restore-job-store";

export type RestoreCancellationStatus =
  | "cancel_requested"
  | "cancelled"
  | "too_late"
  | "stale"
  | "not_found"
  | "failed";

interface ActiveRestoreCancellation {
  readonly previewId: string;
  readonly mode: RestoreIdentityMode;
  readonly jobId: string;
  readonly controller: AbortController;
}

export class RestoreCancellationController {
  readonly #jobs: RestoreJobStore;
  #active: ActiveRestoreCancellation | undefined;

  constructor(jobs: RestoreJobStore) {
    this.#jobs = jobs;
  }

  async run<T>(
    previewId: string,
    mode: RestoreIdentityMode,
    jobId: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const active = { previewId, mode, jobId, controller: new AbortController() };
    this.#active = active;
    try {
      return await operation(active.controller.signal);
    } finally {
      if (this.#active === active) this.#active = undefined;
    }
  }

  cancel(previewId: string, mode: RestoreIdentityMode): RestoreCancellationStatus {
    const active = this.#active;
    if (!active) return "not_found";
    if (active.previewId !== previewId || active.mode !== mode) return "stale";
    try {
      const current = this.#jobs.read(active.jobId);
      if (checkpointDone(current.job, "destination_committed") || isCompleted(current.job.state)) return "too_late";
      const cancelled = this.#jobs.requestCancellation(current);
      active.controller.abort(new PigeDomainError(
        "restore.cancelled",
        "Restore cancellation was requested before durable publication."
      ));
      return cancelled.job.state === "cancelled" ? "cancelled" : "cancel_requested";
    } catch (caught) {
      if (caught instanceof PigeDomainError && caught.code === "job.record_not_found") return "not_found";
      if (caught instanceof PigeDomainError && caught.code === "restore.cancel_not_allowed") return "too_late";
      return "failed";
    }
  }

  settleIfRequested(jobId: string): boolean {
    try {
      const snapshot = this.#jobs.read(jobId);
      if (snapshot.job.state !== "cancel_requested" && snapshot.job.state !== "cancelled") return false;
      if (snapshot.job.state === "cancel_requested") this.#jobs.settleCancellation(snapshot);
      return true;
    } catch {
      return false;
    }
  }
}

function checkpointDone(job: JobRecord, id: string): boolean {
  return job.checkpoints?.some((checkpoint) => checkpoint.id === id && checkpoint.state === "done") ?? false;
}

function isCompleted(state: string): boolean {
  return state === "completed" || state === "completed_with_warnings";
}
