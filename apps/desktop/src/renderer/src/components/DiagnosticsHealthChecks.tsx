import type { DiagnosticsHealth } from "@pige/contracts";

type HealthCheckStatus = DiagnosticsHealth["checks"][number]["status"];

const HEALTH_CHECK_COPY: Readonly<Record<string, Readonly<{
  readonly labelKey: string;
  readonly detailKeys: Readonly<Record<HealthCheckStatus, string>>;
}>>> = {
  diagnostics_store: {
    labelKey: "system.healthCheck.diagnosticsStore",
    detailKeys: {
      ok: "system.healthCheck.diagnosticsStore.ok",
      warning: "system.healthCheck.diagnosticsStore.warning",
      error: "system.healthCheck.diagnosticsStore.error"
    }
  }
};

function healthCheckCopy(check: DiagnosticsHealth["checks"][number]): { readonly labelKey: string; readonly detailKey: string } {
  const projection = HEALTH_CHECK_COPY[check.id];
  return projection
    ? { labelKey: projection.labelKey, detailKey: projection.detailKeys[check.status] }
    : { labelKey: "system.healthCheckUnknown", detailKey: "system.healthCheckUnknown" };
}

export function DiagnosticsHealthChecks(props: {
  readonly health: DiagnosticsHealth | null;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const checks = props.health?.checks;
  if (!checks) return null;

  return (
    <details className="settings-row tall" data-diagnostics-health-checks>
      <summary>{props.t("system.healthChecksSummary")} {checks.length}</summary>
      <ul className="settings-list">
        {checks.length === 0 ? <li>{props.t("system.healthChecksEmpty")}</li> : checks.map((check) => (
          <li key={check.id} className="settings-row" data-health-check-id={check.id} data-health-check-status={check.status}>
            <span className={`settings-status${check.status === "error" ? " degraded" : ""}`}>
              {props.t(`system.healthCheckStatus.${check.status}`)}
            </span>
            <span className="settings-row-copy">
              <strong>{props.t(healthCheckCopy(check).labelKey)}</strong>
              <span>{props.t(healthCheckCopy(check).detailKey)}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
