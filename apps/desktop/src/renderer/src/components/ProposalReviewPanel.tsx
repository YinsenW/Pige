import { useCallback, useEffect, useRef, useState } from "react";
import type { ProposalReviewPreview } from "@pige/contracts";

let requestSequence = 0;

function createRequestId(): string {
  requestSequence += 1;
  return `proposalreq_${Date.now().toString(36).padStart(10, "0")}${requestSequence.toString(36).padStart(6, "0")}`;
}

type ProposalIdentity = {
  readonly activeVaultId: string;
  readonly jobId: string;
  readonly proposalId: string;
};

function ownsIdentity(
  result: ProposalIdentity,
  identity: ProposalIdentity
): boolean {
  return result.activeVaultId === identity.activeVaultId &&
    result.jobId === identity.jobId &&
    result.proposalId === identity.proposalId;
}

function ownsPreview(preview: ProposalReviewPreview, identity: ProposalIdentity): boolean {
  return preview.jobId === identity.jobId && preview.proposalId === identity.proposalId;
}

export function ProposalReviewPanel(props: ProposalIdentity & {
  readonly returnFocus: HTMLButtonElement | null;
  readonly onClose: () => void;
  readonly onResolved: () => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const identity = {
    activeVaultId: props.activeVaultId,
    jobId: props.jobId,
    proposalId: props.proposalId
  } as const;
  const [preview, setPreview] = useState<ProposalReviewPreview | null>(null);
  const [statusKey, setStatusKey] = useState("proposal.opening");
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(false);
  const requestOwnerRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => {
        if (props.returnFocus?.isConnected) props.returnFocus.focus();
      });
    };
  }, [props.returnFocus]);

  const load = useCallback(async (): Promise<void> => {
    const requestOwner = requestOwnerRef.current + 1;
    requestOwnerRef.current = requestOwner;
    const requestId = createRequestId();
    setLoading(true);
    setStatusKey("proposal.opening");
    try {
      const result = await window.pige.proposals.review({ apiVersion: 1, requestId, ...identity });
      if (
        requestOwner !== requestOwnerRef.current ||
        result.requestId !== requestId ||
        !ownsIdentity(result, identity)
      ) return;
      if (result.status === "available" && ownsPreview(result.preview, identity)) {
        setPreview(result.preview);
        setStatusKey("");
      } else {
        setStatusKey(result.status === "not_found"
          ? "proposal.status.not_found"
          : result.status === "stale"
            ? "note.proposal.stale"
            : "proposal.error.load");
      }
    } catch {
      if (requestOwner === requestOwnerRef.current) setStatusKey("proposal.error.load");
    } finally {
      if (requestOwner === requestOwnerRef.current) setLoading(false);
    }
  }, [props.activeVaultId, props.jobId, props.proposalId]);

  useEffect(() => {
    void load();
    return () => {
      requestOwnerRef.current += 1;
    };
  }, [load]);

  const decide = async (decision: "approve" | "reject"): Promise<void> => {
    if (!preview || preview.state !== "ready" || deciding) return;
    const requestOwner = requestOwnerRef.current + 1;
    requestOwnerRef.current = requestOwner;
    const requestId = createRequestId();
    setDeciding(true);
    setStatusKey("proposal.working");
    try {
      const result = await window.pige.proposals.decide({
        apiVersion: 1,
        requestId,
        ...identity,
        expectedRevision: preview.revision,
        decision
      });
      if (
        requestOwner !== requestOwnerRef.current ||
        result.requestId !== requestId ||
        !ownsIdentity(result, identity)
      ) return;
      if (result.preview && ownsPreview(result.preview, identity)) setPreview(result.preview);
      if (result.status === "applied" || result.status === "rejected") {
        props.onClose();
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        await props.onResolved().catch(() => undefined);
        return;
      }
      setStatusKey(result.status === "not_found"
        ? "proposal.status.not_found"
        : result.status === "conflicted"
          ? "proposal.status.conflicted"
          : result.status === "stale"
            ? "note.proposal.stale"
            : "proposal.error.decision");
    } catch {
      if (requestOwner === requestOwnerRef.current) setStatusKey("proposal.error.decision");
    } finally {
      if (requestOwner === requestOwnerRef.current) setDeciding(false);
    }
  };

  return (
    <section
      className="proposal-review-panel"
      aria-labelledby="proposal-review-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !deciding) props.onClose();
      }}
    >
      <header className="proposal-review-panel__header">
        <button
          ref={closeButtonRef}
          className="secondary proposal-review-panel__back"
          type="button"
          disabled={deciding}
          onClick={props.onClose}
        >
          {props.t("proposal.back")}
        </button>
        <h1 id="proposal-review-title">{props.t("proposal.reviewTitle")}</h1>
        {preview ? <p className="proposal-review-panel__summary">{preview.summary}</p> : null}
      </header>

      {preview ? (
        <>
          <dl className="proposal-review-panel__details">
            <div>
              <dt>{props.t("proposal.reason")}</dt>
              <dd>{preview.reason}</dd>
            </div>
          </dl>
          <section className="proposal-review-panel__operations">
            <h3>{props.t("proposal.reviewTitle")}</h3>
            <ol>
              {preview.operationKinds.map((kind, index) => (
                <li key={`${kind}:${index}`}>
                  <strong>{props.t(`proposal.operation.${kind}`)}</strong>
                </li>
              ))}
            </ol>
          </section>
          {preview.warnings.length > 0 ? (
            <section className="proposal-review-panel__warnings">
              <h3>{props.t("proposal.warnings")}</h3>
              <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </section>
          ) : null}
        </>
      ) : null}

      <p className="proposal-review-panel__status" role="status">
        {statusKey ? props.t(statusKey) : ""}
      </p>
      <footer className="proposal-review-panel__actions">
        {!preview && !loading ? (
          <button className="secondary" type="button" onClick={() => void load()}>
            {props.t("proposal.review")}
          </button>
        ) : null}
        {preview ? (
          <>
            <button
              className="secondary"
              type="button"
              disabled={deciding || preview.state !== "ready"}
              onClick={() => void decide("reject")}
            >
              {props.t("proposal.reject")}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={deciding || preview.state !== "ready"}
              onClick={() => void decide("approve")}
            >
              {props.t("proposal.approve")}
            </button>
          </>
        ) : null}
      </footer>
    </section>
  );
}
