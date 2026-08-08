import { useEffect, useRef, useState } from "react";
import type {
  NoteRenderResult,
  NoteRevealGeneratedRequest,
  NoteRevealGeneratedResult
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

type Notice = NoteRevealGeneratedResult["status"] | null;

export function ReaderGeneratedNoteRevealAction(props: {
  readonly activeVaultId: string | null | undefined;
  readonly note: NoteRenderResult;
  readonly onReveal: (request: NoteRevealGeneratedRequest) => Promise<NoteRevealGeneratedResult>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const eligibility = props.note.revealGeneratedEligibility;
  const renderContextId = props.note.renderContextId;
  const ownerIdentity = `${props.activeVaultId ?? ""}:${props.note.summary.pageId}:${renderContextId ?? ""}:${eligibility?.revision ?? ""}`;
  const ownerRef = useRef(ownerIdentity);
  const activeRef = useRef(false);
  const sequenceRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  ownerRef.current = ownerIdentity;

  useEffect(() => {
    const wasActive = activeRef.current;
    sequenceRef.current += 1;
    activeRef.current = false;
    setPending(false);
    setNotice(null);
    if (wasActive) restoreFocusRef.current = true;
  }, [ownerIdentity]);
  useEffect(() => {
    if (pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [pending]);

  if (!props.activeVaultId || !renderContextId || !eligibility?.canReveal) return null;

  const reveal = async (): Promise<void> => {
    if (activeRef.current) return;
    activeRef.current = true;
    const sequence = ++sequenceRef.current;
    const requestedOwner = ownerIdentity;
    const request: NoteRevealGeneratedRequest = {
      apiVersion: 1,
      requestId: `notegeneratedreveal_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId!,
      currentPageId: props.note.summary.pageId,
      renderContextId,
      expectedRevision: eligibility.revision
    };
    setPending(true);
    setNotice(null);
    try {
      const result = await props.onReveal(request);
      if (sequence !== sequenceRef.current || ownerRef.current !== requestedOwner) return;
      setNotice(sameIdentity(request, result) ? result.status : "failed");
    } catch {
      if (sequence === sequenceRef.current && ownerRef.current === requestedOwner) setNotice("failed");
    } finally {
      if (sequence === sequenceRef.current && ownerRef.current === requestedOwner) {
        activeRef.current = false;
        setPending(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
      }
    }
  };

  return <span className="reader-generated-reveal-action">
    <button ref={triggerRef} type="button" className="icon-button" data-reader-action="reveal-generated"
      aria-label={props.t("note.revealGenerated.action")} title={props.t("note.revealGenerated.action")}
      aria-busy={pending} disabled={pending} onClick={() => void reveal()}>
      <PigeIcon name="folder" size={16} />
    </button>
    {notice ? <span className={notice === "revealed" ? "muted" : "error"} role="status" aria-live="polite">
      {props.t(`note.revealGenerated.${notice}`)}
    </span> : null}
  </span>;
}

function sameIdentity(request: NoteRevealGeneratedRequest, result: NoteRevealGeneratedResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision;
}
