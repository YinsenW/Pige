import { useEffect, useState } from "react";
import type { DiagnosticsRecentErrorsResult } from "@pige/contracts";
import { DiagnosticsRecentErrorsCard } from "./DiagnosticsRecentErrorsCard";

export function DiagnosticsRecentErrorsPanel(props: {
  readonly onPrepareSupport: (eventIds: readonly string[]) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [result, setResult] = useState<DiagnosticsRecentErrorsResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        if (typeof window.pige.diagnostics.recentErrors !== "function") {
          throw new Error("diagnostics_recent_errors_unavailable");
        }
        const next = await window.pige.diagnostics.recentErrors({
          apiVersion: 1,
          requestId: `diagrecentreq_${crypto.randomUUID().replaceAll("-", "")}`
        });
        if (!active) return;
        setResult(next);
        setFailed(false);
      } catch {
        if (!active) return;
        setResult(null);
        setFailed(true);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 500);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return (
    <DiagnosticsRecentErrorsCard
      result={result}
      failed={failed}
      onPrepareSupport={() => props.onPrepareSupport(result?.errors.map((error) => error.eventId) ?? [])}
      t={props.t}
    />
  );
}
