import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { JobSummary, KnowledgeActivitySummary } from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import { collectionViewActivityMessageKey } from "../collection-view-lifecycle";
import { NoteTrashRestorePanel } from "./NoteTrashRestorePanel";

export function ActivityHistorySettingsPanel(props: {
  readonly activeVaultId?: string | null;
  readonly activities: readonly KnowledgeActivitySummary[];
  readonly jobs?: readonly JobSummary[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreFailed: boolean;
  readonly undoingId: string | null;
  readonly redoingId: string | null;
  readonly openingId: string | null;
  readonly blockedIds: readonly string[];
  readonly locale: Locale;
  readonly onOpen: (activity: KnowledgeActivitySummary) => Promise<void>;
  readonly onRestored?: (pageId: string) => Promise<boolean>;
  readonly onUndo: (operationId: string) => Promise<void>;
  readonly onRedo: (operationId: string) => Promise<void>;
  readonly onLoadMore: () => Promise<boolean>;
  readonly onCancelJob?: (jobId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const locale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  const loadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const historyTitleRef = useRef<HTMLHeadingElement | null>(null);
  const loadInFlightRef = useRef(false);
  const [focusEpoch, setFocusEpoch] = useState(0);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [cancelFailedJobId, setCancelFailedJobId] = useState<string | null>(null);
  const activeJobs = (props.jobs ?? []).filter(isActivityJob);
  useLayoutEffect(() => {
    if (focusEpoch === 0) return;
    requestAnimationFrame(() => (loadTriggerRef.current ?? historyTitleRef.current)?.focus({ preventScroll: true }));
  }, [focusEpoch]);
  const loadMore = async (): Promise<void> => {
    if (loadInFlightRef.current || props.loadingMore) return;
    loadInFlightRef.current = true;
    try {
      await props.onLoadMore();
    } finally {
      loadInFlightRef.current = false;
      setFocusEpoch((current) => current + 1);
    }
  };
  const cancelJob = async (jobId: string): Promise<void> => {
    if (!props.onCancelJob || cancellingJobId !== null) return;
    setCancellingJobId(jobId);
    setCancelFailedJobId(null);
    try {
      await props.onCancelJob(jobId);
    } catch {
      setCancelFailedJobId(jobId);
    } finally {
      setCancellingJobId(null);
      requestAnimationFrame(() => historyTitleRef.current?.focus({ preventScroll: true }));
    }
  };
  return (
    <section className="settings-page settings-history-page" aria-labelledby="settings-history-title">
      <header className="settings-panel-header">
        <h1 id="settings-history-title" ref={historyTitleRef} tabIndex={-1}>{props.t("activity.historyTitle")}</h1>
        <p>{props.t("activity.historySubtitle")}</p>
      </header>
      <section className="settings-section" aria-labelledby="activity-active-work-title">
        <h2 className="settings-section-title" id="activity-active-work-title">{props.t("activity.activeWork")}</h2>
        {activeJobs.length === 0 ? (
          <p className="settings-note">{props.t("activity.activeWorkEmpty")}</p>
        ) : (
          <div className="settings-card activity-history-list">
            {activeJobs.map((job) => {
              const progress = job.progress?.totalUnits
                ? Math.min(100, Math.max(0, Math.round((job.progress.completedUnits / job.progress.totalUnits) * 100)))
                : null;
              const label = job.sourceDisplayName ?? job.message;
              return <article className="settings-row tall activity-history-row" key={job.id} data-activity-job-id={job.id}>
                <span className="activity-row-dot" aria-hidden="true" />
                <div className="settings-row-copy">
                  <strong>{label}</strong>
                  <span>{props.t(activityJobStateMessageKey(job))}{progress === null ? "" : ` · ${progress}%`}</span>
                  {progress === null ? null : <span
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${label} ${progress}%`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  ><span className="progress-fill" style={{ "--progress": `${progress}%` } as CSSProperties} /></span>}
                  {cancelFailedJobId === job.id ? <span role="alert">{props.t("activity.jobCancelFailed")}</span> : null}
                </div>
                <div className="settings-row-control">
                  {job.canCancel === true && props.onCancelJob ? <button
                    type="button"
                    className="settings-button"
                    disabled={cancellingJobId !== null}
                    data-activity-cancel-job-id={job.id}
                    onClick={() => void cancelJob(job.id)}
                  >{props.t(cancellingJobId === job.id ? "home.jobCancelRequested" : "home.cancelJob")}</button> : null}
                </div>
              </article>;
            })}
          </div>
        )}
      </section>
      <NoteTrashRestorePanel activeVaultId={props.activeVaultId ?? null} locale={props.locale} onCommitted={props.onRestored ?? (async () => false)} t={props.t} />
      <section className="settings-section" aria-labelledby="activity-recent-title">
        <h2 className="settings-section-title" id="activity-recent-title">{props.t("activity.recent")}</h2>
        {props.activities.length === 0 ? (
          <div className="settings-state-copy">
            <strong>{props.t("activity.empty")}</strong>
            <span>{props.t("activity.emptyDescription")}</span>
          </div>
        ) : (
          <div className="settings-card activity-history-list">
            {props.activities.map((activity, index) => {
              const activityMessageKey = collectionViewActivityMessageKey(activity.kind) ?? (activity.kind === "update_collection_cell"
                ? "activity.updatedCollection"
                : activity.kind === "trash_collection_row"
                  ? "activity.trashedCollectionRow"
                : activity.kind === "trash_collection_column"
                  ? "activity.trashedCollectionColumn"
                : activity.kind === "add_collection_lookup" ? "activity.addedCollectionLookup"
                : activity.kind === "add_collection_rollup" ? "activity.addedCollectionRollup"
                : activity.kind === "archive_page" ? "activity.archivedPage" : activity.kind === "restore_page" ? "activity.restoredPage"
                : activity.kind === "update_page"
                  ? "activity.updatedPage"
                : activity.kind === "rename_page"
                  ? "activity.renamedPage"
                : activity.kind === "update_memory"
                  ? "activity.updatedMemory"
                : activity.kind === "trash_memory"
                  ? "activity.trashedMemory"
                : activity.kind === "restore_memory"
                  ? "activity.restoredMemory"
                : activity.kind === "change_setting"
                  ? "activity.changedSetting"
                  : "activity.createdPage");
              const activityLabel = `${props.t(activityMessageKey)}${activity.targetLabel ? `: ${activity.targetLabel}` : ""} (${index + 1})`;
              const createdAt = new Date(activity.createdAt);
              const createdAtLabel = Number.isNaN(createdAt.getTime())
                ? props.t("activity.timeUnavailable")
                : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(createdAt);
              return (
                <article className="settings-row tall activity-history-row" key={activity.operationId} aria-label={activityLabel} data-activity-row-id={activity.operationId} tabIndex={-1}>
                  <span className={`activity-row-dot${activity.status === "undone" ? " is-undone" : ""}`} aria-hidden="true" />
                  <div className="settings-row-copy">
                    <strong>{props.t(activityMessageKey)}{activity.targetLabel ? `: ${activity.targetLabel}` : ""}</strong>
                    <span>{createdAtLabel} · {props.t(activity.status === "undone" ? "activity.statusUndone" : "activity.statusApplied")}</span>
                  </div>
                  <div className="settings-row-control">
                    {activity.status === "applied" && activity.target ? (
                      <button type="button" className="settings-button" aria-label={`${props.t("activity.open")}: ${activityLabel}`} data-activity-open-id={activity.operationId} disabled={props.openingId !== null} onClick={() => void props.onOpen(activity)}>
                        {props.t("activity.open")}
                      </button>
                    ) : null}
                    {activity.canUndo ? (
                      <button type="button" className="settings-button" aria-label={`${props.t("activity.undo")}: ${activityLabel}`} data-activity-undo-id={activity.operationId} disabled={props.undoingId !== null || props.redoingId !== null || props.blockedIds.includes(activity.operationId)} onClick={() => void props.onUndo(activity.operationId)}>
                        {props.t(props.undoingId === activity.operationId ? "activity.undoing" : "activity.undo")}
                      </button>
                    ) : null}
                    {activity.canRedo ? (
                      <button type="button" className="settings-button" aria-label={`${props.t("activity.redo")}: ${activityLabel}`} data-activity-redo-id={activity.operationId} disabled={props.redoingId !== null || props.undoingId !== null || props.blockedIds.includes(activity.operationId)} onClick={() => void props.onRedo(activity.operationId)}>
                        {props.t(props.redoingId === activity.operationId ? "activity.redoing" : "activity.redo")}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {props.hasMore ? (
          <button ref={loadTriggerRef} type="button" className="settings-button" disabled={props.loadingMore} onClick={() => void loadMore()}>
            {props.t(props.loadingMore ? "activity.loadingMore" : "activity.loadMore")}
          </button>
        ) : null}
        {props.loadMoreFailed ? <p role="alert" className="settings-note">{props.t("activity.loadMoreFailed")}</p> : null}
        <p className="settings-note">{props.t("activity.historyNote")}</p>
      </section>
    </section>
  );
}

function isActivityJob(job: JobSummary): boolean {
  return job.class !== "agent_turn" && new Set([
    "queued",
    "running",
    "waiting_dependency",
    "awaiting_review",
    "cancel_requested",
    "failed_retryable"
  ]).has(job.state);
}

function activityJobStateMessageKey(job: JobSummary): string {
  if (job.state === "queued") return "home.jobQueued";
  if (job.state === "running") return "home.jobRunning";
  if (job.state === "cancel_requested") return "home.jobCancelRequested";
  if (job.state === "awaiting_review") return "home.jobReview";
  if (job.state === "waiting_dependency") return "home.jobWaiting";
  return "home.jobFailed";
}
