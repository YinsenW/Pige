import type { DiagnosticsRecentErrorsResult } from "@pige/contracts";

export function DiagnosticsRecentErrorsCard(props: {
  readonly result: DiagnosticsRecentErrorsResult | null;
  readonly failed: boolean;
  readonly onPrepareSupport: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.failed) {
    return <div className="settings-row" role="alert" data-diagnostics-recent-errors-failed>
      <div className="settings-row-copy">
        <strong>{props.t("system.recentErrors")}</strong>
        <span>{props.t("system.recentErrorsUnavailable")}</span>
      </div>
    </div>;
  }

  const errors = props.result?.errors ?? [];
  return <section className="settings-row tall" data-diagnostics-recent-errors aria-labelledby="recent-errors-title">
    <div className="settings-row-copy">
      <strong id="recent-errors-title">{props.t("system.recentErrors")}</strong>
      <span>{props.t(errors.length > 0 ? "system.recentErrorsDescription" : "system.noRecentErrors")}</span>
      {errors.length > 0 ? <small>{props.t("system.recentErrorsSafeSummary")}</small> : null}
      {errors.length > 0 ? <div className="diagnostics-recent-errors-list">
        {errors.map((error) => <details key={error.eventId} className="diagnostics-recent-error">
          <summary><span>{props.t("system.diagnosticEventLevel.error")}</span> <code>{error.code}</code></summary>
          <div className="diagnostics-recent-error-detail">
            <span>{error.message}</span>
            <span>{new Date(error.recordedAt).toLocaleString()}</span>
            {error.redactedDetails ? <dl>
              {Object.entries(error.redactedDetails).map(([key, value]) => <div key={key}>
                <dt>{key}</dt><dd>{String(value)}</dd>
              </div>)}
            </dl> : null}
          </div>
        </details>)}
      </div> : null}
    </div>
    {errors.length > 0 ? <button className="settings-button" type="button" onClick={props.onPrepareSupport}>
      {props.t("system.prepareSupportFromErrors")}
    </button> : null}
  </section>;
}
