import { useEffect, useRef } from "react";
import type { HighRiskConfirmationSummary } from "@pige/contracts";

type ConfirmationDecision = "allow" | "deny";

export function HighRiskConfirmationDialog(props: {
  readonly confirmation: HighRiskConfirmationSummary;
  readonly resolving: boolean;
  readonly error: boolean;
  readonly onResolve: (decision: ConfirmationDecision) => void;
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

  const subject = props.confirmation.presentation.subject;
  const subjectText = subject.kind === "item_count"
    ? `${subject.count} ${props.t(subject.count === 1 ? "confirmation.item" : "confirmation.items")}`
    : subject.value;

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
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!props.resolving) props.onResolve("deny");
            return;
          }
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
          <h2 id="high-risk-confirmation-title">{props.t("confirmation.title")}</h2>
          <p id="high-risk-confirmation-description">{props.t("confirmation.description")}</p>
        </div>
        <dl className="confirmation-summary">
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
            <dd>{subjectText}</dd>
          </div>
        </dl>
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
            {props.resolving ? props.t("confirmation.resolving") : props.t("confirmation.allow")}
          </button>
        </div>
      </section>
    </div>
  );
}
