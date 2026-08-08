import type { DiagnosticsRecentErrorsResult } from "@pige/contracts";

export function DiagnosticsRecentErrorsCard(props: {
  readonly result: DiagnosticsRecentErrorsResult | null;
  readonly failed: boolean;
  readonly onPrepareSupport: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.failed && !props.result) {
    return (
      <section
        className="settings-card diagnostics-recent-errors-card diagnostics-recent-errors-card-failed"
        role="alert"
        aria-labelledby="recent-errors-title"
        data-diagnostics-recent-errors-failed
      >
        <div className="diagnostics-recent-errors-header">
          <div className="diagnostics-recent-errors-heading">
            <span className="diagnostics-recent-errors-eyebrow">{props.t("system.diagnosticsTitle")}</span>
            <h3 id="recent-errors-title">{props.t("system.recentErrors")}</h3>
            <p>{props.t("system.recentErrorsUnavailable")}</p>
          </div>
          <span className="settings-status warning" role="status">
            {props.t("system.recentErrorsUnavailable")}
          </span>
        </div>
      </section>
    );
  }

  const errors = props.result?.errors ?? [];
  const hasErrors = errors.length > 0;
  const checkedAt = props.result
    ? new Date(props.result.checkedAt).toLocaleString()
    : null;

  return (
    <section
      className="settings-card diagnostics-recent-errors-card"
      data-diagnostics-recent-errors
      aria-labelledby="recent-errors-title"
      aria-describedby="recent-errors-description"
    >
      {props.failed ? <p className="error" role="alert">{props.t("system.recentErrorsUnavailable")}</p> : null}
      <div className="diagnostics-recent-errors-header">
        <div className="diagnostics-recent-errors-heading">
          <span className="diagnostics-recent-errors-eyebrow">{props.t("system.diagnosticsTitle")}</span>
          <h3 id="recent-errors-title">{props.t("system.recentErrors")}</h3>
          <p id="recent-errors-description">
            {props.t(hasErrors ? "system.recentErrorsDescription" : "system.noRecentErrors")}
          </p>
        </div>
        <span className={hasErrors ? "settings-status warning" : "settings-status"} role="status">
          {hasErrors ? props.t("system.diagnosticEventLevel.error") : props.t("system.noRecentErrors")}
        </span>
      </div>

      <div className="diagnostics-recent-errors-meta">
        <span>{props.t("system.recentErrorsSafeSummary")}</span>
        {checkedAt ? <span>{props.t("maintenance.lastChecked")}: {checkedAt}</span> : null}
      </div>

      {hasErrors ? (
        <div className="diagnostics-recent-errors-content">
          <div className="diagnostics-recent-errors-list" role="list">
            {errors.map((error) => {
              const recordedAt = new Date(error.recordedAt).toLocaleString();
              return (
                <details key={error.eventId} className="diagnostics-recent-error" role="listitem">
                  <summary className="diagnostics-recent-error-summary">
                    <span className="diagnostics-recent-error-marker" aria-hidden="true" />
                    <span className="diagnostics-recent-error-heading">
                      <strong>{error.code}</strong>
                      <time dateTime={error.recordedAt}>{recordedAt}</time>
                    </span>
                    <span className="diagnostics-recent-error-level">
                      {props.t("system.diagnosticEventLevel.error")}
                    </span>
                  </summary>
                  <div className="diagnostics-recent-error-detail">
                    <p>{error.message}</p>
                    {error.redactedDetails ? <dl>
                      {Object.entries(error.redactedDetails).map(([key, value]) => <div key={key}>
                        <dt>{key}</dt><dd>{String(value)}</dd>
                      </div>)}
                    </dl> : null}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="diagnostics-recent-errors-actions">
            <button className="settings-button primary" type="button" onClick={props.onPrepareSupport}>
              {props.t("system.prepareSupportFromErrors")}
            </button>
          </div>
        </div>
      ) : (
        <div className="diagnostics-recent-errors-empty" role="status">
          <span className="diagnostics-recent-errors-empty-mark" aria-hidden="true">✓</span>
          <span>{props.t("system.noRecentErrors")}</span>
        </div>
      )}
    </section>
  );
}
