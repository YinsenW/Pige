import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskExecutionPlanSummary, TaskInteractionPendingResult } from "@pige/contracts";

type Translate = (key: string) => string;

function format(template: string, values: Readonly<Record<string, string | number>>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function TaskExecutionPlanDetails(props: {
  readonly plan: TaskExecutionPlanSummary;
  readonly t: Translate;
}): React.JSX.Element {
  return (
    <dl className="confirmation-summary" data-task-execution-plan={props.plan.planId}>
      <div>
        <dt>{props.t("confirmation.action")}</dt>
        <dd>{format(props.t("taskExecution.plan.summary"), {
          tool: props.plan.toolLabel,
          version: props.plan.resolvedVersion,
          source: props.plan.sourceOrigin,
          count: props.plan.stepCount
        })}</dd>
      </div>
      <div>
        <dt>{props.t("confirmation.subject")}</dt>
        <dd>
          <ul>
            {props.plan.integrities.map((integrity) => <li key={integrity}><code>{integrity}</code></li>)}
            {props.plan.skillCount > 0 ? (
              <li>{format(props.t("taskExecution.plan.skills"), {
                count: props.plan.skillCount,
                agents: props.plan.targetAgents.join(", ")
              })}</li>
            ) : null}
            {props.plan.destinationRoots.length > 0 ? (
              <li>{format(props.t("taskExecution.plan.destinations"), {
                destinations: props.plan.destinationRoots.join(", ")
              })}</li>
            ) : null}
            {props.plan.requiresBrowserOAuth ? <li>{props.t("taskExecution.plan.oauth")}</li> : null}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

export function TaskExecutionInteractionStatus(props: { readonly t: Translate }): React.JSX.Element | null {
  const [interaction, setInteraction] = useState<TaskInteractionPendingResult>({ status: "none" });
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);
  const interactionRef = useRef(interaction);
  interactionRef.current = interaction;

  const adopt = useCallback((next: TaskInteractionPendingResult): void => {
    if (!mountedRef.current) return;
    setInteraction(next);
    setOpening(false);
    setFailed(false);
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      adopt(await window.pige.taskExecution.interaction());
    } catch {
      if (mountedRef.current) setFailed(true);
    }
  }, [adopt]);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = window.pige.taskExecution.onInteractionChanged(adopt);
    void refresh();
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [adopt, refresh]);

  if (interaction.status !== "browser_oauth") return null;
  const identity = `${interaction.interactionId}:${interaction.planId}:${interaction.jobId}:${interaction.stepOrdinal}:${interaction.revision}`;
  const visibleIdentity = `${interaction.planId}:${interaction.stepOrdinal}:${interaction.revision}`;
  const open = async (): Promise<void> => {
    if (opening) return;
    const requested = interaction;
    setOpening(true);
    setFailed(false);
    try {
      const result = await window.pige.taskExecution.openInteraction({
        interactionId: requested.interactionId,
        planId: requested.planId,
        jobId: requested.jobId,
        stepOrdinal: requested.stepOrdinal,
        expectedRevision: requested.revision
      });
      if (!mountedRef.current || interactionRef.current.status !== "browser_oauth") return;
      const current = interactionRef.current;
      if (`${current.interactionId}:${current.planId}:${current.jobId}:${current.stepOrdinal}:${current.revision}` !== identity) return;
      if (result.status === "opened" || result.status === "not_found") adopt({ status: "none" });
      else if (result.status === "stale") await refresh();
      else {
        setOpening(false);
        setFailed(true);
      }
    } catch {
      if (mountedRef.current && interactionRef.current.status === "browser_oauth") {
        setOpening(false);
        setFailed(true);
      }
    }
  };

  return (
    <article
      className="conversation-message role-assistant conversation-status-message state-running"
      data-task-interaction={visibleIdentity}
      role="status"
      aria-live="polite"
    >
      <div className="conversation-status-content">
        <strong>{props.t("taskExecution.oauth.title")}</strong>
        <p>{props.t("taskExecution.oauth.waiting")}</p>
        <p>{interaction.origin}</p>
        <small>{interaction.planId} · {interaction.stepOrdinal}</small>
        {failed ? <p role="alert">{props.t("error.generic")}</p> : null}
        <button type="button" className="ghost" disabled={opening} onClick={() => void open()}>
          {props.t("taskExecution.oauth.open")}
        </button>
      </div>
    </article>
  );
}
