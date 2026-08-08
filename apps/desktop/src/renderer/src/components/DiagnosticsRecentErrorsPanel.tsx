import { useEffect, useRef, useState } from "react";
import type { DiagnosticsRecentErrorsResult } from "@pige/contracts";
import { DiagnosticsRecentErrorsCard } from "./DiagnosticsRecentErrorsCard";

export function DiagnosticsRecentErrorsPanel(props: {
  readonly onPrepareSupport: (eventIds: readonly string[]) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [result, setResult] = useState<DiagnosticsRecentErrorsResult | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const requestId = `diagrecentreq_${crypto.randomUUID().replaceAll("-", "")}`;
      try {
        if (typeof window.pige.diagnostics.recentErrors !== "function") {
          throw new Error("diagnostics_recent_errors_unavailable");
        }
        const next = await window.pige.diagnostics.recentErrors({
          apiVersion: 1,
          requestId
        });
        if (!active) return;
        if (next.requestId !== requestId || next.apiVersion !== 1 || next.localOnly !== true) return;
        setResult(next);
        setFailed(false);
      } catch {
        if (!active) return;
        setResult(null);
        setFailed(true);
      } finally {
        inFlightRef.current = false;
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
