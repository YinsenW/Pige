import { useEffect, useRef, useState } from "react";
import type {
  NoteRenderResult,
  NoteRevisionHistoryListRequest,
  NoteRevisionHistoryOpenRequest,
  NoteRevisionHistoryRestoreRequest,
  NoteRevisionHistorySummary
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

export function NoteRevisionHistoryDialog(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId: string | undefined;
  readonly t: (key: string) => string;
  readonly onCommitted: (render: NoteRenderResult) => void;
}): React.JSX.Element | null {
  const eligibility = props.note.historyEligibility;
  const renderContextId = props.note.renderContextId;
  const canBrowse = eligibility?.canBrowse === true && Boolean(props.activeVaultId && renderContextId);
  const ownerIdentity = `${props.activeVaultId ?? ""}:${props.note.summary.pageId}:${renderContextId ?? ""}:${eligibility?.revision ?? ""}`;
  const ownerRef = useRef(ownerIdentity);
  ownerRef.current = ownerIdentity;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestActiveRef = useRef(false);
  const sequenceRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<readonly NoteRevisionHistorySummary[]>([]);
  const [selected, setSelected] = useState<NoteRevisionHistorySummary | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");

  useEffect(() => {
    sequenceRef.current += 1;
    requestActiveRef.current = false;
    setOpen(false);
    setRevisions([]);
    setSelected(null);
    setPreviewHtml(null);
    setConfirming(false);
    setStatus("idle");
  }, [ownerIdentity]);

  if (!canBrowse || !eligibility || !renderContextId || !props.activeVaultId) return null;

  const identity = {
    activeVaultId: props.activeVaultId,
    pageId: props.note.summary.pageId,
    renderContextId,
    expectedRevision: eligibility.revision
  };
  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  const close = (): void => {
    if (requestActiveRef.current) return;
    setOpen(false);
    setConfirming(false);
    restoreFocus();
  };
  const load = async (): Promise<void> => {
    if (requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++sequenceRef.current;
    const owner = ownerIdentity;
    setStatus("loading");
    const request: NoteRevisionHistoryListRequest = {
      apiVersion: 1, requestId: requestId(), ...identity
    };
    try {
      const result = await window.pige.notes.listRevisionHistory(request);
      if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (matches(request, result) && result.status === "ready") {
        setRevisions(result.revisions);
        setStatus("idle");
      } else setStatus("failed");
    } catch { if (sequence === sequenceRef.current) setStatus("failed"); }
    finally { if (sequence === sequenceRef.current) requestActiveRef.current = false; }
  };
  const openRevision = async (revision: NoteRevisionHistorySummary): Promise<void> => {
    if (requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++sequenceRef.current;
    const owner = ownerIdentity;
    setSelected(revision);
    setPreviewHtml(null);
    setStatus("loading");
    const request: NoteRevisionHistoryOpenRequest = {
      apiVersion: 1, requestId: requestId(), ...identity, revisionId: revision.revisionId
    };
    try {
      const result = await window.pige.notes.openRevisionHistory(request);
      if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (matches(request, result) && result.status === "opened" && result.revision.revisionId === revision.revisionId) {
        setPreviewHtml(result.html);
        setStatus("idle");
      } else setStatus("failed");
    } catch { if (sequence === sequenceRef.current) setStatus("failed"); }
    finally { if (sequence === sequenceRef.current) requestActiveRef.current = false; }
  };
  const restore = async (): Promise<void> => {
    if (!selected || selected.isCurrent || requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++sequenceRef.current;
    const owner = ownerIdentity;
    setStatus("loading");
    const request: NoteRevisionHistoryRestoreRequest = {
      apiVersion: 1, requestId: requestId(), ...identity, revisionId: selected.revisionId
    };
    try {
      const result = await window.pige.notes.restoreRevisionHistory(request);
      if (sequence !== sequenceRef.current || owner !== ownerRef.current) return;
      if (matches(request, result) && result.status === "committed" &&
        result.render.summary.pageId === request.pageId &&
        result.render.summary.pageType === props.note.summary.pageType) {
        setOpen(false);
        props.onCommitted(result.render);
        restoreFocus();
      } else setStatus("failed");
    } catch { if (sequence === sequenceRef.current) setStatus("failed"); }
    finally { if (sequence === sequenceRef.current) requestActiveRef.current = false; }
  };

  return <>
    <button ref={triggerRef} type="button" className="icon-button" data-reader-action="history"
      aria-label={props.t("note.history.action")} title={props.t("note.history.action")}
      onClick={() => { setOpen(true); setStatus("idle"); void load(); }}>
      <PigeIcon name="activity" size={16} />
    </button>
    {open ? <div className="confirmation-backdrop">
      <section className="confirmation-dialog" role="dialog" aria-modal="true"
        aria-labelledby="note-history-title" aria-busy={status === "loading"}
        onKeyDown={(event) => { if (event.key === "Escape" && status !== "loading") { event.preventDefault(); close(); } }}>
        <div className="confirmation-copy">
          <h2 id="note-history-title">{props.t("note.history.title")}</h2>
          <p>{props.t("note.history.description")}</p>
        </div>
        {status === "failed" ? <p className="error" role="alert">{props.t("note.history.failed")}</p> : null}
        <div className="activity-history-list">
          {revisions.map((revision) => <button key={revision.revisionId} type="button" className="secondary"
            disabled={status === "loading"} onClick={() => void openRevision(revision)}>
            {revision.isCurrent ? props.t("note.history.current") : new Date(revision.createdAt).toLocaleString()}
          </button>)}
        </div>
        {selected && previewHtml !== null ? <>
          <div className="reader-markdown" data-note-history-preview dangerouslySetInnerHTML={{ __html: previewHtml }} />
          {!selected.isCurrent ? confirming
            ? <p>{props.t("note.history.restoreDescription")}</p>
            : <button type="button" className="secondary" onClick={() => setConfirming(true)}>{props.t("note.history.restore")}</button>
          : null}
        </> : null}
        <div className="confirmation-actions">
          <button ref={closeRef} type="button" className="secondary" disabled={status === "loading"} onClick={close}>
            {props.t("note.history.close")}
          </button>
          {confirming ? <button type="button" className="primary" disabled={status === "loading"} onClick={() => void restore()}>
            {status === "loading" ? props.t("note.history.restoring") : props.t("note.history.restoreConfirm")}
          </button> : null}
        </div>
      </section>
    </div> : null}
  </>;
}

function requestId(): `notehistoryreq_${string}` {
  return `notehistoryreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function matches(request: NoteRevisionHistoryListRequest, result: NoteRevisionHistoryListRequest): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.pageId === request.pageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision;
}
