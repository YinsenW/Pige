import { useEffect, useRef, type Ref } from "react";
import type { DiagnosticsWorkflowSummary } from "@pige/contracts";
import { DiagnosticsJobCard } from "./DiagnosticsWorkflowCards";

type DiagnosticsNotice = { readonly kind: "success" | "error"; readonly key: string } | null;

export function DiagnosticsSupportBundleDestinationRepair(props: {
  readonly workflow: DiagnosticsWorkflowSummary | null;
  readonly busy: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onWorkflowChange: (workflow: DiagnosticsWorkflowSummary) => void;
  readonly onNotice: (notice: DiagnosticsNotice) => void;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly onReveal: () => void;
  readonly revealTriggerRef?: Ref<HTMLButtonElement>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const chooseDestinationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const jobCardRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef(false);
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (props.busy || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    chooseDestinationTriggerRef.current?.focus();
    if (document.activeElement !== chooseDestinationTriggerRef.current) jobCardRef.current?.focus();
  }, [props.busy]);

  const reconnect = async (): Promise<void> => {
    const workflow = props.workflow;
    if (workflow?.job?.repairAction !== "choose_destination" || props.busy || inFlightRef.current) return;
    const requestId = `diagrepairreq_${crypto.randomUUID().replaceAll("-", "")}`;
    inFlightRef.current = true;
    props.onBusyChange(true);
    props.onNotice(null);
    try {
      const result = await window.pige.diagnostics.reconnectSupportBundleDestination({
        apiVersion: 1,
        requestId,
        activeVaultId: workflow.activeVaultId,
        jobId: workflow.job.jobId,
        scopeContextId: workflow.scopeContextId,
        expectedRevision: workflow.revision
      });
      if (result.requestId !== requestId) throw new Error("diagnostics_destination_repair_identity_mismatch");
      if (result.status !== "failed") props.onWorkflowChange(result.workflow);
      if (result.status === "resumed") {
        props.onNotice({ kind: "success", key: "system.exportRetryStarted" });
      } else if (result.status !== "cancelled") {
        props.onNotice({ kind: "error", key: result.status === "stale" ? "system.diagnosticsStale" : "support.exportFailed" });
      }
    } catch {
      props.onNotice({ kind: "error", key: "support.exportFailed" });
    } finally {
      restoreFocusRef.current = true;
      inFlightRef.current = false;
      props.onBusyChange(false);
    }
  };

  if (!props.workflow?.job) return null;
  return <DiagnosticsJobCard
    job={props.workflow.job}
    busy={props.busy}
    onCancel={props.onCancel}
    onRetry={props.onRetry}
    onReveal={props.onReveal}
    revealTriggerRef={props.revealTriggerRef}
    chooseDestinationTriggerRef={chooseDestinationTriggerRef}
    jobCardRef={jobCardRef}
    onChooseDestination={() => void reconnect()}
    t={props.t}
  />;
}
