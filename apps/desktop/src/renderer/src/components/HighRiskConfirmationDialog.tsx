import { useEffect, useRef } from "react";
import type { HighRiskConfirmationPendingResult, HighRiskConfirmationSummary } from "@pige/contracts";
import { TaskExecutionPlanDetails } from "./TaskExecutionInteraction";

type RememberScopedGrant = Extract<
  HighRiskConfirmationPendingResult,
  { readonly status: "pending" }
>["rememberScopedGrant"];

export function HighRiskConfirmationDialog(props: {
  readonly confirmation: HighRiskConfirmationSummary;
  readonly rememberScopedGrant?: RememberScopedGrant;
  readonly resolving: boolean;
  readonly error: boolean;
  readonly onResolve: (decision: "allow" | "deny", grantContextId?: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLElement | null>(null);
  const denyButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => denyButtonRef.current?.focus());
    return () => {
      const previous = previousFocusRef.current;
      window.requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
        else document.querySelector<HTMLElement>('[data-home-composer="true"]')?.focus();
      });
    };
  }, [props.confirmation.confirmationId]);

  useEffect(() => {
    const denyOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.isComposing && !props.resolving) props.onResolve("deny");
    };
    document.addEventListener("keydown", denyOnEscape, true);
    return () => document.removeEventListener("keydown", denyOnEscape, true);
  }, [props.onResolve, props.resolving]);

  const subject = props.confirmation.presentation.subject;
  const subjectText = subject.kind === "item_count"
    ? `${subject.count} ${props.t(subject.count === 1 ? "confirmation.item" : "confirmation.items")}`
    : subject.value;
  const reviewedPlan = subject.kind === "reviewed_execution_plan" ? subject.plan : null;
  const externalWebSkill = subject.kind === "external_web_skill" ? subject : null;

  return (
    <div className="confirmation-backdrop">
      <section
        ref={dialogRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="high-risk-confirmation-title"
        aria-describedby="high-risk-confirmation-description"
        aria-busy={props.resolving}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []
          );
          if (focusable.length === 0) {
            event.preventDefault();
            return;
          }
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="confirmation-icon" aria-hidden="true">!</div>
        <div className="confirmation-copy">
          <h2 id="high-risk-confirmation-title">
            {props.t(reviewedPlan ? "taskExecution.plan.title" : "confirmation.title")}
          </h2>
          <p id="high-risk-confirmation-description">{props.t("confirmation.description")}</p>
        </div>
        {reviewedPlan ? <TaskExecutionPlanDetails plan={reviewedPlan} t={props.t} /> : <dl className="confirmation-summary">
          <div>
            <dt>{props.t("confirmation.action")}</dt>
            <dd>{props.t(`confirmation.action.${props.confirmation.presentation.action}`)}</dd>
          </div>
          <div>
            <dt>{props.t("confirmation.target")}</dt>
            <dd>{props.t(`confirmation.target.${props.confirmation.presentation.target}`)}</dd>
          </div>
          <div>
            <dt>{props.t("confirmation.subject")}</dt>
            <dd>{externalWebSkill ? `${externalWebSkill.value} · v${externalWebSkill.version}` : subjectText}</dd>
          </div>
          {externalWebSkill ? <>
            <div><dt>{props.t("confirmation.origin")}</dt><dd>{externalWebSkill.origin}</dd></div>
            <div><dt>{props.t("confirmation.capability")}</dt><dd>{props.t(`confirmation.capability.${externalWebSkill.capability}`)}</dd></div>
            <div><dt>{props.t("confirmation.dataBoundary")}</dt><dd>{props.t(`skills.boundary.${externalWebSkill.dataBoundary}`)}</dd></div>
          </> : null}
        </dl>}
        {props.rememberScopedGrant ? (
          <dl className="confirmation-summary">
            <div>
              <dt>{props.t("privacy.rememberScope")}</dt>
              <dd>{props.rememberScopedGrant.safeScopeLabel}</dd>
            </div>
          </dl>
        ) : null}
        {props.error ? (
          <p className="confirmation-error" role="alert">{props.t("confirmation.failed")}</p>
        ) : null}
        <div className="confirmation-actions">
          <button
            ref={denyButtonRef}
            type="button"
            className="ghost"
            disabled={props.resolving}
            onClick={() => props.onResolve("deny")}
          >
            {props.t("confirmation.deny")}
          </button>
          <button
            type="button"
            className="danger"
            disabled={props.resolving}
            onClick={() => props.onResolve("allow")}
          >
            {props.resolving
              ? props.t("confirmation.resolving")
              : props.t(props.rememberScopedGrant
                ? "privacy.allowOnce"
                : reviewedPlan
                  ? "taskExecution.plan.allow"
                  : "confirmation.allow")}
          </button>
          {props.rememberScopedGrant ? (
            <button
              type="button"
              className="danger"
              disabled={props.resolving}
              onClick={() => props.onResolve("allow", props.rememberScopedGrant?.grantContextId)}
            >
              {props.t("privacy.rememberScope")}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
