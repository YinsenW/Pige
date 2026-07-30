import { PigeDomainError } from "@pige/domain";
import type { JobRecord } from "@pige/schemas";
import type { JobExecutionCoordinator } from "./job-execution-coordinator";
import type { JobRecordSnapshot } from "./job-record-store";

export function requestRestoreJobCancellation(
  owner: JobExecutionCoordinator,
  snapshot: JobRecordSnapshot
): JobRecordSnapshot {
  if (snapshot.job.state === "cancelled" || snapshot.job.state === "cancel_requested") return snapshot;
  if (snapshot.job.state === "queued") {
    return owner.cancelPending(snapshot, {
      requestedBy: "user",
      safeCheckpointId: lastCompletedRestoreCheckpoint(snapshot.job) ?? "before_apply",
      message: "Restore was cancelled before durable publication."
    });
  }
  if (snapshot.job.state !== "running") {
    throw new PigeDomainError("restore.cancel_not_allowed", "This Restore Job cannot be cancelled now.");
  }
  return owner.requestCancellation(snapshot, {
    requestedBy: "user",
    message: "Restore cancellation was requested at the next safe checkpoint."
  });
}

export function settleRestoreJobCancellation(
  owner: JobExecutionCoordinator,
  snapshot: JobRecordSnapshot
): JobRecordSnapshot {
  if (snapshot.job.state === "cancelled") return snapshot;
  if (snapshot.job.state !== "cancel_requested") {
    throw new PigeDomainError("restore.cancel_not_allowed", "This Restore Job has no pending cancellation.");
  }
  return owner.cancellationOutcome(snapshot, {
    cancelledMessage: "Restore stopped before durable publication.",
    preservedResultMessage: "Restore cancellation arrived after durable publication.",
    safeCheckpointId: lastCompletedRestoreCheckpoint(snapshot.job) ?? "before_apply",
    durableResultComplete: false,
    facts: { stage: "restoring" }
  });
}

function lastCompletedRestoreCheckpoint(job: JobRecord): string | undefined {
  return [...(job.checkpoints ?? [])].reverse().find((checkpoint) => checkpoint.state === "done")?.id;
}
