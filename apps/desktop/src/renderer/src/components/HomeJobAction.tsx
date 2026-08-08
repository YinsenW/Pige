import { useRef, useState, type RefObject } from "react";
import type { JobSummary } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export interface HomeJobRepairAction {
  readonly label: string;
  readonly pendingLabel: string;
  readonly pending?: boolean;
  readonly onActivate: () => Promise<void>;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}

export function HomeJobAction(props: {
  readonly job: JobSummary;
  readonly compact?: boolean;
  readonly sourceWaitingForModel: boolean;
  readonly ownsSourceModelAction: boolean;
  readonly retryEligible: boolean;
  readonly repair?: HomeJobRepairAction;
  readonly dependencyRepair?: HomeJobRepairAction;
  readonly onOpenModels: (opener: HTMLButtonElement) => Promise<void> | void;
  readonly onOpenLocalCapabilities: (opener: HTMLButtonElement) => Promise<void> | void;
  readonly onCancelJob: (jobId: string) => Promise<unknown> | void;
  readonly onRetryJob: (jobId: string) => Promise<unknown> | void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modelOpenActiveRef = useRef(false);
  const [modelOpenPending, setModelOpenPending] = useState(false);
  const repairButtonRef = useRef<HTMLButtonElement>(null);
  const repairActiveRef = useRef(false);
  const [repairPending, setRepairPending] = useState(false);

  const activateRepair = async (): Promise<void> => {
    if (!props.repair || repairActiveRef.current) return;
    repairActiveRef.current = true;
    setRepairPending(true);
    try {
      await props.repair.onActivate();
    } catch {
      // The owner projects a body-free failure; this control only retains interaction state.
    } finally {
      repairActiveRef.current = false;
      setRepairPending(false);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
        (repairButtonRef.current ?? props.repair?.returnFocusRef?.current)?.focus()));
    }
  };

  const activateModels = async (opener: HTMLButtonElement): Promise<void> => {
    if (modelOpenActiveRef.current) return;
    modelOpenActiveRef.current = true;
    setModelOpenPending(true);
    try {
      await props.onOpenModels(opener);
    } finally {
      modelOpenActiveRef.current = false;
      setModelOpenPending(false);
    }
  };

  if (props.ownsSourceModelAction) {
    return <button
      ref={modelButtonRef}
      className="job-action"
      type="button"
      disabled={modelOpenPending}
      aria-busy={modelOpenPending || undefined}
      onClick={(event) => void activateModels(event.currentTarget)}
    >
      {props.t("home.connectModel")}
    </button>;
  }
  if (props.sourceWaitingForModel) return null;
  if (props.dependencyRepair) {
    const pending = repairPending || props.dependencyRepair.pending === true;
    return <button
      ref={repairButtonRef}
      className="job-action"
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void activateRepair()}
    >
      {pending ? props.dependencyRepair.pendingLabel : props.dependencyRepair.label}
    </button>;
  }
  const localCapabilityWait = props.job.waitingDependency;
  if (props.job.state === "waiting_dependency" && localCapabilityWait && (
    (localCapabilityWait.dependencyKind === "local_tool" && localCapabilityWait.requiredAction === "repair_tool") ||
    (localCapabilityWait.dependencyKind === "runtime_capability" && localCapabilityWait.requiredAction === "enable_capability")
  )) {
    return <button className="job-action" type="button" onClick={(event) => void props.onOpenLocalCapabilities(event.currentTarget)}>
      {props.t("settings.section.capabilities")}
    </button>;
  }
  if (props.repair) {
    const pending = repairPending || props.repair.pending === true;
    return <button
      ref={repairButtonRef}
      className="job-action"
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void activateRepair()}
    >
      {pending ? props.repair.pendingLabel : props.repair.label}
    </button>;
  }
  if (props.job.canCancel === true || props.job.state === "cancel_requested") {
    return <button
      className={props.compact ? "task-icon-action" : "job-action"}
      type="button"
      title={props.t("home.cancelJob")}
      aria-label={props.t("home.cancelJob")}
      disabled={props.job.state === "cancel_requested"}
      onClick={() => void props.onCancelJob(props.job.id)}
    >
      <PigeIcon name="trash" size={13} />
    </button>;
  }
  if (props.retryEligible) {
    return <button
      className="job-action"
      type="button"
      title={props.t("home.retryJob")}
      aria-label={props.t("home.retryJob")}
      onClick={() => void props.onRetryJob(props.job.id)}
    >
      {props.t("home.retryJob")}
    </button>;
  }
  return null;
}
