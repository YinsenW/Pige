import { useEffect, useRef, useState } from "react";
import type {
  NoteClaimConfidence,
  NoteRenderResult,
  NoteSetClaimConfidenceRequest,
  NoteSetClaimConfidenceResult
} from "@pige/contracts";

const confidenceValues: readonly NoteClaimConfidence[] = ["low", "medium", "high"];

export function ReaderClaimConfidenceControl(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly onSetConfidence: (
    request: NoteSetClaimConfidenceRequest
  ) => Promise<NoteSetClaimConfidenceResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.claimConfidence;
  const renderContextId = props.note.renderContextId;
  const ownerIdentity = `${props.activeVaultId}:${props.note.summary.pageId}:${renderContextId ?? ""}:${summary?.revision ?? ""}`;
  const [draft, setDraft] = useState<NoteClaimConfidence | null>(summary?.confidence ?? null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Exclude<NoteSetClaimConfidenceResult["status"], "committed"> | null>(null);
  const ownerIdentityRef = useRef(ownerIdentity);
  const activeRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const wasActive = activeRef.current;
    ownerIdentityRef.current = ownerIdentity;
    activeRef.current = false;
    setDraft(summary?.confidence ?? null);
    setPending(false);
    setNotice(null);
    if (wasActive) restoreFocusRef.current = true;
  }, [ownerIdentity, summary?.confidence]);

  useEffect(() => {
    if (pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
      selectRef.current?.focus({ preventScroll: true })));
  }, [pending]);

  if (props.note.summary.pageType !== "claim" || !summary || !renderContextId || !draft) return null;

  const setConfidence = async (confidence: NoteClaimConfidence): Promise<void> => {
    if (!summary.canChange || activeRef.current || confidence === summary.confidence) {
      setDraft(summary.confidence);
      return;
    }
    activeRef.current = true;
    const requestOwner = ownerIdentity;
    const request: NoteSetClaimConfidenceRequest = {
      apiVersion: 1,
      requestId: `noteclaimconfreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId,
      renderContextId,
      expectedRevision: summary.revision,
      confidence
    };
    setDraft(confidence);
    setPending(true);
    setNotice(null);
    try {
      const result = await props.onSetConfidence(request);
      if (ownerIdentityRef.current !== requestOwner || !sameIdentity(request, result)) return;
      if (result.status !== "committed") {
        setNotice(result.status);
        return;
      }
      if (
        result.render.summary.pageId !== request.currentPageId ||
        result.render.summary.pageType !== "claim" ||
        result.render.claimConfidence?.confidence !== confidence ||
        result.render.claimConfidence.canChange !== true
      ) {
        setNotice("failed");
        return;
      }
      props.onCommitted(result.render);
    } catch {
      if (ownerIdentityRef.current === requestOwner) setNotice("failed");
    } finally {
      if (ownerIdentityRef.current === requestOwner) {
        activeRef.current = false;
        restoreFocusRef.current = true;
        setPending(false);
      }
    }
  };

  return <span className="reader-claim-confidence">
    <label htmlFor="reader-claim-confidence">{props.t("note.claimConfidence.label")}</label>
    <select id="reader-claim-confidence" ref={selectRef} value={draft}
      disabled={!summary.canChange || pending} aria-busy={pending || undefined}
      onChange={(event) => void setConfidence(event.currentTarget.value as NoteClaimConfidence)}>
      {confidenceValues.map((confidence) => <option key={confidence} value={confidence}>
        {props.t(`note.claimConfidence.value.${confidence}`)}
      </option>)}
    </select>
    {pending ? <span role="status">{props.t("note.claimConfidence.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"} aria-live="polite">
      {props.t(`note.claimConfidence.notice.${notice}`)}
    </span> : null}
  </span>;
}

function sameIdentity(
  request: NoteSetClaimConfidenceRequest,
  result: NoteSetClaimConfidenceResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision &&
    result.confidence === request.confidence;
}
