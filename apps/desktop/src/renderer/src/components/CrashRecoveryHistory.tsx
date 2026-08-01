import type { DiagnosticsHealth } from "@pige/contracts";

export function CrashRecoveryHistory(props: {
  readonly history: DiagnosticsHealth["crashRecoveryHistory"];
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (!props.history?.length) return null;
  return (
    <div className="settings-row tall" data-crash-recovery-history>
      <div className="settings-row-copy">
        <strong>{props.t("system.crashRecovery.history")}</strong>
        <details>
          <summary>{props.t("system.crashRecovery.historySummary")} {props.history.length}</summary>
          <ul>
            {props.history.slice().reverse().map((recovery) => {
              const completedAt = recovery.completedAt ?? recovery.detectedAt;
              return (
                <li key={recovery.recoveryId}>
                  <time dateTime={completedAt}>{new Date(completedAt).toLocaleString()}</time>
                  {" · "}{props.t(`system.crashRecovery.status.${recovery.status}`)}
                  {" · "}{props.t("system.crashRecovery.jobs")} {recovery.jobsRecovered}
                  {" · "}{props.t("system.crashRecovery.retry")} {recovery.jobsNeedRetry}
                </li>
              );
            })}
          </ul>
        </details>
      </div>
    </div>
  );
}
