import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { JobSummary, KnowledgeActivityListResult, KnowledgeActivitySummary } from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import { collectionViewActivityMessageKey } from "../collection-view-lifecycle";
import { NoteTrashRestorePanel } from "./NoteTrashRestorePanel";
import { SourceTrashRestorePanel } from "./SourceTrashRestorePanel";

export function ActivityHistorySettingsPanel(props: {
  readonly activeVaultId?: string | null;
  readonly activities: readonly KnowledgeActivitySummary[];
  readonly total?: number;
  readonly filter?: {
    readonly query?: string;
    readonly status?: "applied" | "undone";
  };
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
  readonly onSearchResult?: (
    result: KnowledgeActivityListResult,
    filter: { readonly query?: string; readonly status?: "applied" | "undone" }
  ) => void;
  readonly onCancelJob?: (jobId: string) => Promise<unknown>;
  readonly onRetryJob?: (jobId: string) => Promise<unknown>;
  readonly onRefreshJobs?: () => Promise<boolean>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const locale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  const loadTriggerRef = useRef<HTMLButtonElement | null>(null);
  const historyTitleRef = useRef<HTMLHeadingElement | null>(null);
  const loadInFlightRef = useRef(false);
  const [focusEpoch, setFocusEpoch] = useState(0);
  const jobRowRefs = useRef(new Map<string, HTMLElement>());
  const refreshButtonRef = useRef<HTMLButtonElement | null>(null);
  const [jobAction, setJobAction] = useState<{ readonly jobId: string; readonly kind: "cancel" | "retry" } | null>(null);
  const [jobActionFailure, setJobActionFailure] = useState<{ readonly jobId: string; readonly kind: "cancel" | "retry" } | null>(null);
  const [jobsRefreshing, setJobsRefreshing] = useState(false);
  const [jobsRefreshFailed, setJobsRefreshFailed] = useState(false);
  const [historyQuery, setHistoryQuery] = useState(props.filter?.query ?? "");
  const [historyStatus, setHistoryStatus] = useState<"all" | "applied" | "undone">(props.filter?.status ?? "all");
  const [historySearching, setHistorySearching] = useState(false);
  const [historySearchFailed, setHistorySearchFailed] = useState(false);
  const [historyAppliedFilter, setHistoryAppliedFilter] = useState<{
    readonly query: string;
    readonly status: "all" | "applied" | "undone";
  }>({ query: props.filter?.query ?? "", status: props.filter?.status ?? "all" });
  const historySearchInFlightRef = useRef(false);
  const historySearchSequenceRef = useRef(0);
  const historyOwnerRef = useRef(props.activeVaultId);
  const historySearchReturnFocusRef = useRef<HTMLElement | null>(null);
  historyOwnerRef.current = props.activeVaultId;
  const backgroundJobs = (props.jobs ?? []).filter((job) => job.class !== "agent_turn");
  const activeJobs = backgroundJobs.filter(isActivityJob);
  const recentJobs = backgroundJobs.filter(isTerminalActivityJob).slice(0, 20);
  useLayoutEffect(() => {
    if (focusEpoch === 0) return;
    requestAnimationFrame(() => (loadTriggerRef.current ?? historyTitleRef.current)?.focus({ preventScroll: true }));
  }, [focusEpoch]);
  useLayoutEffect(() => {
    setHistoryQuery(props.filter?.query ?? "");
    setHistoryStatus(props.filter?.status ?? "all");
    setHistorySearching(false);
    setHistorySearchFailed(false);
    setHistoryAppliedFilter({ query: props.filter?.query ?? "", status: props.filter?.status ?? "all" });
    historySearchInFlightRef.current = false;
    historySearchSequenceRef.current += 1;
  }, [props.activeVaultId]);
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
  const searchHistory = async (): Promise<void> => {
    if (!props.onSearchResult || historySearchInFlightRef.current || !props.activeVaultId) return;
    historySearchInFlightRef.current = true;
    setHistorySearching(true);
    setHistorySearchFailed(false);
    const query = historyQuery.trim();
    const status = historyStatus;
    const owner = props.activeVaultId;
    const sequence = ++historySearchSequenceRef.current;
    const returnFocus = historySearchReturnFocusRef.current;
    try {
      const filter = { ...(query ? { query } : {}), ...(status === "all" ? {} : { status }) };
      const result = await window.pige.activity.list({ limit: 20, ...filter });
      if (sequence !== historySearchSequenceRef.current || historyOwnerRef.current !== owner || result.activeVaultId !== owner) return;
      props.onSearchResult(result, filter);
      setHistoryAppliedFilter({ query, status });
    } catch {
      if (sequence === historySearchSequenceRef.current && historyOwnerRef.current === owner)
        setHistorySearchFailed(true);
    } finally {
      if (sequence === historySearchSequenceRef.current && historyOwnerRef.current === owner) {
        historySearchInFlightRef.current = false;
        setHistorySearching(false);
        requestAnimationFrame(() => returnFocus?.isConnected
          ? returnFocus.focus({ preventScroll: true })
          : historyTitleRef.current?.focus({ preventScroll: true }));
      }
    }
  };
  const restoreJobFocus = (jobId?: string, fallback?: HTMLElement | null): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = (jobId ? jobRowRefs.current.get(jobId) : null) ?? fallback ?? historyTitleRef.current;
      target?.focus({ preventScroll: true });
    }));
  };
  const refreshJobs = async (): Promise<boolean> => {
    if (!props.onRefreshJobs || jobsRefreshing || jobAction !== null) return false;
    setJobsRefreshing(true);
    setJobsRefreshFailed(false);
    try {
      const refreshed = await props.onRefreshJobs();
      if (!refreshed) setJobsRefreshFailed(true);
      return refreshed;
    } finally {
      setJobsRefreshing(false);
      restoreJobFocus(undefined, refreshButtonRef.current);
    }
  };
  const actOnJob = async (kind: "cancel" | "retry", jobId: string): Promise<void> => {
    const handler = kind === "cancel" ? props.onCancelJob : props.onRetryJob;
    if (!handler || jobAction !== null || jobsRefreshing) return;
    setJobAction({ jobId, kind });
    setJobActionFailure(null);
    setJobsRefreshFailed(false);
    let succeeded = false;
    try {
      succeeded = await handler(jobId) !== false;
      if (succeeded && props.onRefreshJobs) {
        const refreshed = await props.onRefreshJobs();
        if (!refreshed) setJobsRefreshFailed(true);
      }
      if (!succeeded) setJobActionFailure({ jobId, kind });
    } catch {
      setJobActionFailure({ jobId, kind });
    } finally {
      setJobAction(null);
      restoreJobFocus(jobId);
    }
  };
  const renderJob = (job: JobSummary): React.JSX.Element => {
    const progress = job.progress?.totalUnits
      ? Math.min(100, Math.max(0, Math.round((job.progress.completedUnits / job.progress.totalUnits) * 100)))
      : null;
    const label = job.sourceDisplayName ?? job.message;
    const updatedAt = new Date(job.updatedAt);
    const updatedAtLabel = Number.isNaN(updatedAt.getTime())
      ? props.t("activity.timeUnavailable")
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(updatedAt);
    const pending = jobAction?.jobId === job.id;
    const failure = jobActionFailure?.jobId === job.id ? jobActionFailure.kind : null;
    return <article ref={(node) => { if (node) jobRowRefs.current.set(job.id, node); else jobRowRefs.current.delete(job.id); }}
      className="settings-row tall activity-history-row" key={job.id} data-activity-job-id={job.id} tabIndex={-1}>
      <span className="activity-row-dot" aria-hidden="true" />
      <div className="settings-row-copy">
        <strong>{label}</strong>
        <span>{props.t(activityJobStateMessageKey(job))}{progress === null ? "" : ` · ${progress}%`} · {updatedAtLabel}</span>
        {progress === null ? null : <span className="progress-track" role="progressbar"
          aria-label={`${label} ${progress}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <span className="progress-fill" style={{ "--progress": `${progress}%` } as CSSProperties} />
        </span>}
        {job.agentKnowledgeOutcome ? <span data-agent-knowledge-outcome={job.agentKnowledgeOutcome.kind}>
          {props.t(`activity.agentOutcome.${job.agentKnowledgeOutcome.kind}`)}
          {job.agentKnowledgeOutcome.knowledgeFields.length > 0
            ? ` · ${job.agentKnowledgeOutcome.knowledgeFields.length} ${props.t("activity.agentOutcome.fields")}` : ""}
          {job.agentKnowledgeOutcome.citationRefs.length > 0
            ? ` · ${job.agentKnowledgeOutcome.citationRefs.length} ${props.t("activity.agentOutcome.citations")}` : ""}
          {job.agentKnowledgeOutcome.writeRefs.length > 0
            ? ` · ${job.agentKnowledgeOutcome.writeRefs.length} ${props.t("activity.agentOutcome.writes")}` : ""}
          {job.agentKnowledgeOutcome.recoveryRefs.length > 0
            ? ` · ${job.agentKnowledgeOutcome.recoveryRefs.length} ${props.t("activity.agentOutcome.recovery")}` : ""}
          {job.agentKnowledgeOutcome.undoOperationIds.length > 0
            ? ` · ${props.t("activity.agentOutcome.undoAvailable")}` : ""}
        </span> : null}
        {job.error ? <span>{props.t(job.error.messageKey)}</span> : null}
        {failure ? <span role="alert">{props.t(failure === "retry" ? "activity.jobRetryFailed" : "activity.jobCancelFailed")}</span> : null}
      </div>
      <div className="settings-row-control">
        {job.canRetry === true && props.onRetryJob ? <button type="button" className="settings-button"
          disabled={jobAction !== null || jobsRefreshing} data-activity-retry-job-id={job.id}
          onClick={() => void actOnJob("retry", job.id)}>{props.t(pending && jobAction?.kind === "retry"
            ? "activity.jobRetrying" : "home.retryJob")}</button> : null}
        {job.canCancel === true && props.onCancelJob ? <button type="button" className="settings-button"
          disabled={jobAction !== null || jobsRefreshing} data-activity-cancel-job-id={job.id}
          onClick={() => void actOnJob("cancel", job.id)}>{props.t(pending && jobAction?.kind === "cancel"
            ? "home.jobCancelRequested" : "home.cancelJob")}</button> : null}
      </div>
    </article>;
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
            {activeJobs.map(renderJob)}
          </div>
        )}
      </section>
      <section className="settings-section" aria-labelledby="activity-background-history-title">
        <div className="settings-section-heading-row">
          <h2 className="settings-section-title" id="activity-background-history-title">{props.t("activity.backgroundHistory")}</h2>
          {props.onRefreshJobs ? <button ref={refreshButtonRef} type="button" className="settings-button"
            disabled={jobsRefreshing || jobAction !== null} onClick={() => void refreshJobs()}>{props.t(jobsRefreshing
              ? "activity.backgroundRefreshing" : "activity.backgroundRefresh")}</button> : null}
        </div>
        {recentJobs.length === 0 ? <p className="settings-note">{props.t("activity.backgroundEmpty")}</p>
          : <div className="settings-card activity-history-list">{recentJobs.map(renderJob)}</div>}
        {jobsRefreshFailed ? <p role="alert" className="settings-note">{props.t("activity.backgroundRefreshFailed")}</p> : null}
      </section>
      <NoteTrashRestorePanel activeVaultId={props.activeVaultId ?? null} locale={props.locale} onCommitted={props.onRestored ?? (async () => false)} t={props.t} />
      <SourceTrashRestorePanel activeVaultId={props.activeVaultId ?? null}
        onCommitted={props.onRestored ?? (async () => false)} t={props.t} />
      <section className="settings-section" aria-labelledby="activity-recent-title">
        <h2 className="settings-section-title" id="activity-recent-title">{props.t("activity.recent")}</h2>
        {props.onSearchResult ? <form className="settings-inline-actions" role="search"
          aria-label={props.t("activity.search.title")} onSubmit={(event) => {
            event.preventDefault();
            historySearchReturnFocusRef.current = event.currentTarget.ownerDocument.activeElement as HTMLElement | null;
            void searchHistory();
          }}>
          <label className="settings-search-wrap"><span className="sr-only">{props.t("activity.search.label")}</span>
            <input className="settings-search" type="search" maxLength={120} value={historyQuery}
              placeholder={props.t("activity.search.placeholder")} aria-label={props.t("activity.search.label")}
              disabled={historySearching} onInput={(event) => setHistoryQuery(event.currentTarget.value)} />
          </label>
          <select className="settings-select" value={historyStatus} aria-label={props.t("activity.search.status")}
            disabled={historySearching} onChange={(event) => setHistoryStatus(event.currentTarget.value as typeof historyStatus)}>
            <option value="all">{props.t("activity.search.all")}</option>
            <option value="applied">{props.t("activity.statusApplied")}</option>
            <option value="undone">{props.t("activity.statusUndone")}</option>
          </select>
          <button type="submit" className="settings-button" disabled={historySearching}>
            {props.t(historySearching ? "activity.search.searching" : "activity.search.submit")}
          </button>
        </form> : null}
        {props.onSearchResult ? <p className="settings-note">{props.t("activity.search.count")
          .replace("{visible}", String(props.activities.length)).replace("{total}", String(props.total ?? props.activities.length))}</p> : null}
        {historySearchFailed ? <p className="settings-note" role="alert">{props.t("activity.search.failed")}</p> : null}
        {props.activities.length === 0 ? (
          <div className="settings-state-copy">
            <strong>{props.t(historyAppliedFilter.query || historyAppliedFilter.status !== "all" ? "activity.search.empty" : "activity.empty")}</strong>
            <span>{props.t(historyAppliedFilter.query || historyAppliedFilter.status !== "all" ? "activity.search.emptyDescription" : "activity.emptyDescription")}</span>
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
                : activity.kind === "update_collection_lookup" ? "activity.updatedCollectionLookup"
                : activity.kind === "add_collection_rollup" ? "activity.addedCollectionRollup"
                : activity.kind === "update_collection_rollup" ? "activity.updatedCollectionRollup"
                : activity.kind === "archive_page" ? "activity.archivedPage" : activity.kind === "restore_page" ? "activity.restoredPage"
                : activity.kind === "update_page"
                  ? "activity.updatedPage"
                : activity.kind === "rename_page"
                  ? "activity.renamedPage"
                : activity.kind === "create_memory"
                  ? "activity.createdMemory"
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
  return job.class !== "agent_turn" && !isTerminalActivityJob(job);
}

function isTerminalActivityJob(job: JobSummary): boolean {
  return new Set(["completed", "completed_with_warnings", "failed_final", "cancelled"]).has(job.state);
}

function activityJobStateMessageKey(job: JobSummary): string {
  if (job.state === "queued") return "home.jobQueued";
  if (job.state === "running") return "home.jobRunning";
  if (job.state === "cancel_requested") return "home.jobCancelRequested";
  if (job.state === "awaiting_review") return "home.jobReview";
  if (job.state === "waiting_dependency") return "home.jobWaiting";
  if (job.state.startsWith("waiting_")) return "activity.jobWaitingPermission";
  if (job.state === "completed") return "activity.jobCompleted";
  if (job.state === "completed_with_warnings") return "activity.jobCompletedWithWarnings";
  if (job.state === "cancelled") return "activity.jobCancelled";
  if (job.state === "failed_final") return "activity.jobFailedFinal";
  return "home.jobFailed";
}
