import { useEffect, useId, useRef } from "react";
import type { ProposalDecisionResult } from "@pige/contracts";
import type { ConfirmationProposal } from "@pige/schemas";

export interface ProposalReviewPanelProps {
  readonly proposal: ConfirmationProposal;
  readonly busy: boolean;
  readonly outcome: ProposalDecisionResult["status"] | null;
  readonly decisionStateUnknown: boolean;
  readonly errorMessageKey: string | null;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly onClose: () => void;
  readonly t: (key: string) => string;
}

const terminalOutcomes = new Set<ProposalDecisionResult["status"]>([
  "approved",
  "applied",
  "rejected",
  "conflicted",
  "not_found"
]);

const outcomeKeys: Record<ProposalDecisionResult["status"], string> = {
  approved: "proposal.status.approved",
  applied: "proposal.status.applied",
  rejected: "proposal.status.rejected",
  conflicted: "proposal.status.conflicted",
  not_found: "proposal.status.not_found",
  not_allowed: "proposal.status.not_allowed"
};

export function ProposalReviewPanel({
  proposal,
  busy,
  outcome,
  decisionStateUnknown,
  errorMessageKey,
  onApprove,
  onReject,
  onClose,
  t
}: ProposalReviewPanelProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  const decisionsDisabled =
    busy || decisionStateUnknown || proposal.state !== "ready" || (outcome !== null && terminalOutcomes.has(outcome));
  const statusText = busy
    ? t("proposal.working")
    : decisionStateUnknown
      ? t("proposal.status.unknown")
      : outcome === null ? null : t(outcomeKeys[outcome]);

  return (
    <section className="proposal-review-panel" aria-labelledby={headingId} aria-busy={busy}>
      <header className="proposal-review-panel__header">
        <button
          type="button"
          className="ghost proposal-review-panel__back"
          aria-label={t("proposal.back")}
          disabled={busy}
          onClick={onClose}
        >
          {t("proposal.back")}
        </button>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {t("proposal.reviewTitle")}
        </h1>
      </header>

      <p className="proposal-review-panel__summary">{proposal.summary}</p>

      <dl className="proposal-review-panel__details">
        <div>
          <dt>{t("proposal.reason")}</dt>
          <dd>{proposal.reason}</dd>
        </div>
      </dl>

      <section className="proposal-review-panel__operations" aria-label={t("proposal.target")}>
        <h3>{t("proposal.target")}</h3>
        <ol>
          {proposal.proposedOperations.map((operation, index) => {
            const operationKey = `proposal.operation.${operation.kind}`;
            const target = operation.kind === "rename" ? `${operation.from} -> ${operation.to}` : operation.path;

            return (
              <li key={`${operation.kind}-${index}-${target}`}>
                <div className="proposal-review-panel__operation-heading">
                  <span>{t(operationKey)}</span>
                  <span>{target}</span>
                </div>
                {(operation.kind === "create" || operation.kind === "update") && (
                  <div className="proposal-review-panel__preview">
                    <h4>{t("proposal.markdownPreview")}</h4>
                    <pre aria-label={t("proposal.markdownPreview")}>{operation.content}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {proposal.warnings.length > 0 ? (
        <section className="proposal-review-panel__warnings" aria-label={t("proposal.warnings")}>
          <h3>{t("proposal.warnings")}</h3>
          <ul>
            {proposal.warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="proposal-review-panel__status" aria-live="polite" aria-atomic="true">
        {statusText !== null && <p>{statusText}</p>}
        {errorMessageKey !== null && <p role="alert">{t(errorMessageKey)}</p>}
      </div>

      <footer className="proposal-review-panel__actions">
        <button type="button" className="secondary" disabled={decisionsDisabled} onClick={onReject}>
          {t("proposal.reject")}
        </button>
        <button
          type="button"
          disabled={decisionsDisabled || outcome === "not_allowed"}
          onClick={onApprove}
        >
          {t("proposal.approve")}
        </button>
      </footer>
    </section>
  );
}
