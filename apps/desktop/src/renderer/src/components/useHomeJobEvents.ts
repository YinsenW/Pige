import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { JobChangedEvent, JobSummary } from "@pige/contracts";
import type { JobClass, JobState } from "@pige/schemas";

export function useHomeJobEvents(
  activeVaultId: string | undefined,
  homeJobClasses: readonly JobClass[],
  refreshVaultState: () => Promise<void>,
  setRecentJobs: Dispatch<SetStateAction<readonly JobSummary[]>>,
  setBackupJobs: Dispatch<SetStateAction<readonly JobSummary[]>>,
  setActivityJobs: Dispatch<SetStateAction<readonly JobSummary[]>>
): void {
  const refreshRef = useRef(refreshVaultState);
  refreshRef.current = refreshVaultState;
  useEffect(() => {
    if (!activeVaultId) return;
    return window.pige.jobs.onChanged((event) => {
      if (event.activeVaultId !== activeVaultId) return;
      setActivityJobs((current) => adoptActivityJobChange(current, event));
      setRecentJobs((current) => adoptHomeJobChange(current, event, homeJobClasses));
      if (event.job.backupKind === "user_backup") {
        setBackupJobs((current) => adoptBackupJobChange(current, event));
      }
      if (isTerminalJobState(event.job.state)) void refreshRef.current();
    });
  }, [activeVaultId, homeJobClasses, setActivityJobs, setBackupJobs, setRecentJobs]);
}

function adoptActivityJobChange(current: readonly JobSummary[], event: JobChangedEvent): readonly JobSummary[] {
  return [...current.filter((job) => job.id !== event.job.id), jobSummaryFromChangedEvent(event)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, 100);
}

function adoptHomeJobChange(
  current: readonly JobSummary[], event: JobChangedEvent, homeJobClasses: readonly JobClass[]
): readonly JobSummary[] {
  const withoutChanged = current.filter((job) => job.id !== event.job.id);
  if (!homeJobClasses.includes(event.job.class) || isTerminalJobState(event.job.state)) return withoutChanged;
  return [...withoutChanged, jobSummaryFromChangedEvent(event)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, 100);
}

function adoptBackupJobChange(current: readonly JobSummary[], event: JobChangedEvent): readonly JobSummary[] {
  const withoutChanged = current.filter((job) => job.id !== event.job.id);
  if (event.job.backupKind !== "user_backup" || isTerminalJobState(event.job.state)) return withoutChanged;
  return [...withoutChanged, jobSummaryFromChangedEvent(event)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, 20);
}

function jobSummaryFromChangedEvent(event: JobChangedEvent): JobSummary {
  const job = event.job;
  return {
    id: job.id, class: job.class, state: job.state,
    ...(job.stage !== undefined ? { stage: job.stage } : {}),
    ...(job.progress !== undefined ? { progress: job.progress } : {}),
    ...(job.sourceId !== undefined ? { sourceId: job.sourceId } : {}),
    ...(job.captureId !== undefined ? { captureId: job.captureId } : {}),
    ...(job.conversationEventId !== undefined ? { conversationEventId: job.conversationEventId } : {}),
    ...(job.sourceDisplayName !== undefined ? { sourceDisplayName: job.sourceDisplayName } : {}),
    ...(job.sourceKind !== undefined ? { sourceKind: job.sourceKind } : {}),
    ...(job.backupKind !== undefined ? { backupKind: job.backupKind } : {}),
    canReconnectDependency: job.canReconnectDependency,
    canReconnectBackupDestination: job.canReconnectBackupDestination,
    canContinueIncomplete: job.canContinueIncomplete,
    canCancel: job.canCancel,
    canRetry: job.canRetry,
    ...(job.error !== undefined ? { error: job.error } : {}),
    message: job.message, createdAt: job.createdAt, updatedAt: job.updatedAt
  };
}

function isTerminalJobState(state: JobState): boolean {
  return state === "completed" || state === "completed_with_warnings" || state === "cancelled" || state === "compacted";
}
