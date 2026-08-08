import { useRef, useState, type CSSProperties } from "react";
import type { JobSummary } from "@pige/contracts";
import { createJobCancelRequest } from "../job-cancel-request";

const INDEX_REBUILD_ACTIVE_STATES: readonly JobSummary["state"][] = [
  "queued",
  "running",
  "waiting_dependency",
  "cancel_requested"
];

export interface IndexRebuildStatusProps {
  readonly activeVaultId: string;
  readonly jobs: readonly JobSummary[];
  readonly onCancelOutcome: (outcome: "accepted" | "failed") => void;
  readonly t: (key: string) => string;
}

export function IndexRebuildStatus(props: IndexRebuildStatusProps): React.JSX.Element | null {
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const job = props.jobs
    .filter((candidate) => candidate.class === "index_rebuild")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const active = job !== null && INDEX_REBUILD_ACTIVE_STATES.includes(job.state);

  if (!job || !active) return null;

  const cancel = async (): Promise<void> => {
    if (!job.canCancel || cancelingJobId) return;
    const request = createJobCancelRequest({
      activeVaultId: props.activeVaultId,
      jobId: job.id,
      expectedUpdatedAt: job.updatedAt
    });
    setCancelingJobId(job.id);
    try {
      const result = await window.pige.jobs.cancel(request);
      const identityMatches = result.requestId === request.requestId &&
        result.activeVaultId === request.activeVaultId &&
        result.jobId === request.jobId;
      const accepted = result.status === "cancel_requested" || result.status === "cancelled";
      if (!identityMatches || !accepted || result.job?.id !== job.id) {
        props.onCancelOutcome("failed");
        return;
      }
      props.onCancelOutcome("accepted");
    } catch {
      props.onCancelOutcome("failed");
    } finally {
      setCancelingJobId(null);
      window.requestAnimationFrame(() => cancelButtonRef.current?.focus({ preventScroll: true }));
    }
  };

  return (
    <div className="settings-row" data-maintenance-index-job-id={job.id}>
      <div className="settings-row-copy">
        <strong>{props.t("maintenance.rebuildProgressTitle")}</strong>
        {job.progress?.totalUnits ? (
          <div
            className="progress-track"
            role="progressbar"
            aria-label={props.t("maintenance.rebuildProgress")}
            aria-valuemin={0}
            aria-valuemax={job.progress.totalUnits}
            aria-valuenow={job.progress.completedUnits}
          >
            <span
              className="progress-fill"
              style={{
                "--progress": `${Math.min(100, Math.max(0, Math.round(
                  job.progress.completedUnits / job.progress.totalUnits * 100
                )))}%`
              } as CSSProperties}
            />
          </div>
        ) : null}
        <span>
          {job.progress?.totalUnits
            ? `${job.progress.completedUnits}/${job.progress.totalUnits}`
            : props.t("maintenance.rebuildProgressUnknown")}
        </span>
      </div>
      <button
        ref={cancelButtonRef}
        className="settings-button settings-action"
        type="button"
        data-maintenance-cancel-rebuild={job.id}
        disabled={cancelingJobId === job.id || job.state === "cancel_requested" || !job.canCancel}
        onClick={() => void cancel()}
      >
        {props.t(cancelingJobId === job.id || job.state === "cancel_requested"
          ? "maintenance.cancelRequested"
          : "maintenance.cancelRebuild")}
      </button>
    </div>
  );
}
