import { useLayoutEffect, useRef, useState } from "react";
import type { NoteRenderResult, SourceTrashRequest, SourceTrashResult } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export function ReaderSourceTrashAction(props: {
  readonly activeVaultId?: string;
  readonly note: NoteRenderResult;
  readonly onTrash: (request: SourceTrashRequest) => Promise<SourceTrashResult>;
  readonly onCommitted: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const eligibility = props.note.sourceTrashEligibility;
  const renderContextId = props.note.renderContextId;
  const [confirming, setConfirming] = useState(false), [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false), triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null), inFlightRef = useRef(false);
  const owner = `${props.activeVaultId ?? ""}:${props.note.summary.pageId}:${renderContextId ?? ""}:${eligibility?.sourceId ?? ""}:${eligibility?.sourceRevision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  useLayoutEffect(() => { if (confirming) confirmRef.current?.focus({ preventScroll: true }); }, [confirming]);
  useLayoutEffect(() => { if (failed && !confirming) triggerRef.current?.focus({ preventScroll: true }); }, [failed, confirming]);
  if (!props.activeVaultId || !renderContextId || !eligibility?.canTrash || props.note.summary.pageType !== "source") return null;
  const restoreFocus = (): void => { window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
    triggerRef.current?.focus({ preventScroll: true }))); };
  const submit = async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true; setPending(true); setFailed(false);
    const request: SourceTrashRequest = { apiVersion: 1,
      requestId: `sourcetrashreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId!, currentPageId: props.note.summary.pageId, renderContextId,
      sourceId: eligibility.sourceId, expectedSourceRevision: eligibility.sourceRevision, confirmation: "move_to_trash" };
    const snapshot = owner;
    try {
      const result = await props.onTrash(request);
      if (ownerRef.current !== snapshot || result.requestId !== request.requestId ||
        result.activeVaultId !== request.activeVaultId || result.currentPageId !== request.currentPageId ||
        result.renderContextId !== request.renderContextId || result.sourceId !== request.sourceId ||
        result.expectedSourceRevision !== request.expectedSourceRevision) return;
      if (result.status === "committed") { props.onCommitted(); return; }
      setFailed(true); setConfirming(false); restoreFocus();
    } catch { if (ownerRef.current === snapshot) { setFailed(true); setConfirming(false); restoreFocus(); } }
    finally { if (ownerRef.current === snapshot) { inFlightRef.current = false; setPending(false); } }
  };
  return <div className="reader-source-trash-action">
    <button ref={triggerRef} type="button" className="icon-button" data-reader-source-trash
      aria-label={props.t("note.sourceTrash.action")} title={props.t("note.sourceTrash.action")}
      disabled={pending} onClick={() => { setFailed(false); setConfirming(true); }}>
      <PigeIcon name="trash" size={16} />
    </button>
    {confirming ? <div role="alertdialog" aria-modal="true" aria-labelledby="source-trash-title" onKeyDown={(event) => {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      setConfirming(false);
      setFailed(false);
      restoreFocus();
    }}>
      <strong id="source-trash-title">{props.t("note.sourceTrash.title")}</strong>
      <p>{props.t(eligibility.storage === "reference_original"
        ? "note.sourceTrash.referenceDescription" : "note.sourceTrash.managedDescription")}</p>
      <button type="button" className="settings-button" disabled={pending} onClick={() => {
        setConfirming(false); restoreFocus();
      }}>{props.t("note.sourceTrash.cancel")}</button>
      <button ref={confirmRef} type="button" className="settings-button danger" disabled={pending}
        onClick={() => void submit()}>{props.t(pending ? "note.sourceTrash.moving" : "note.sourceTrash.confirm")}</button>
    </div> : null}
    {failed ? <span role="alert">{props.t("note.sourceTrash.failed")}</span> : null}
  </div>;
}
