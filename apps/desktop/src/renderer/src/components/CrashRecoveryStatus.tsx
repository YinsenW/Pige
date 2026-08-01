import type { DiagnosticsHealth } from "@pige/contracts";
import { CrashRecoveryHistory } from "./CrashRecoveryHistory";

export function CrashRecoveryStatus(props: {
  readonly recovery: DiagnosticsHealth["crashRecovery"];
  readonly history: DiagnosticsHealth["crashRecoveryHistory"];
  readonly onReviewActivity?: (() => void) | undefined;
  readonly onRepairSources?: (() => void) | undefined;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const recovery = props.recovery;
  return <>
    {recovery ? (
      <div className="settings-row tall" data-crash-recovery-status={recovery.status}>
        <div className="settings-row-copy">
          <strong>{props.t("system.crashRecovery")}</strong>
          <span>{props.t(`system.crashRecovery.${recovery.status}`)}</span>
          <small>
            {props.t("system.crashRecovery.captures")} {recovery.capturesPreserved}
            {" · "}{props.t("system.crashRecovery.jobs")} {recovery.jobsRecovered}
            {" · "}{props.t("system.crashRecovery.retry")} {recovery.jobsNeedRetry}
            {" · "}{props.t("system.crashRecovery.proposals")} {recovery.proposalsRecovered}
            {" · "}{props.t("system.crashRecovery.awaitingReview")} {recovery.proposalsAwaitingReview}
            {" · "}{props.t("system.crashRecovery.sources")} {recovery.sourcesNeedRepair}
          </small>
        </div>
        <div className="settings-row-control">
          <span className={`settings-status ${recovery.status === "needs_attention" ? "degraded" : ""}`}>
            {props.t(`system.crashRecovery.status.${recovery.status}`)}
          </span>
          {(recovery.jobsNeedRetry > 0 || recovery.proposalsAwaitingReview > 0) && props.onReviewActivity ? (
            <button className="settings-button" type="button" onClick={props.onReviewActivity}>
              {props.t("system.crashRecovery.reviewActivity")}
            </button>
          ) : null}
          {recovery.sourcesNeedRepair > 0 && props.onRepairSources ? (
            <button className="settings-button" type="button" onClick={props.onRepairSources}>
              {props.t("system.crashRecovery.repairSources")}
            </button>
          ) : null}
        </div>
      </div>
    ) : null}
    <CrashRecoveryHistory history={props.history} t={props.t} />
  </>;
}
