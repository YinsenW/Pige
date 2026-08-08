import { useEffect, useRef, useState } from "react";
import type {
  NoteChangeClaimEvidenceRequest, NoteChangeClaimEvidenceResult, NoteClaimEvidenceItem,
  NoteRenderResult, NoteSearchClaimEvidenceRequest, NoteSearchClaimEvidenceResult
} from "@pige/contracts";

type Intent = { readonly action: "add" | "remove"; readonly target: NoteClaimEvidenceItem };

export function ReaderClaimEvidence(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly search: (request: NoteSearchClaimEvidenceRequest) => Promise<NoteSearchClaimEvidenceResult>;
  readonly change: (request: NoteChangeClaimEvidenceRequest) => Promise<NoteChangeClaimEvidenceResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.claimEvidence, context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const busyRef = useRef(false), focusRef = useRef<HTMLElement | null>(null), sectionRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null), restoreIntentFocusRef = useRef(false);
  const [query, setQuery] = useState(""), [results, setResults] = useState<readonly NoteClaimEvidenceItem[]>([]);
  const [intent, setIntent] = useState<Intent | null>(null), [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setQuery(""); setResults([]); setIntent(null); setPending(false); setNotice(null); busyRef.current = false;
  }, [owner]);
  useEffect(() => {
    if (intent) confirmRef.current?.focus();
    else if (restoreIntentFocusRef.current) {
      restoreIntentFocusRef.current = false;
      (focusRef.current?.isConnected ? focusRef.current : sectionRef.current)?.focus({ preventScroll: true });
    }
  }, [intent]);
  if (props.note.summary.pageType !== "claim" || !summary || !context) return null;

  const restoreFocus = (): void => { window.setTimeout(() => {
    (focusRef.current?.isConnected ? focusRef.current : sectionRef.current)?.focus({ preventScroll: true });
  }, 0); };
  const search = async (): Promise<void> => {
    if (busyRef.current || !query.trim()) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request = identityRequest(props, context, summary.revision, { query: query.trim() });
    try {
      const result = await props.search(request);
      if (ownerRef.current !== identity) return;
      if (result.status === "ready" && sameSearch(request, result)) setResults(result.candidates);
      else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); }
    finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } }
  };
  const commit = async (): Promise<void> => {
    if (busyRef.current || !intent) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner, selected = intent;
    const request: NoteChangeClaimEvidenceRequest = identityRequest(props, context, summary.revision, {
      action: selected.action, sourcePageId: selected.target.sourcePageId, sourceId: selected.target.sourceId,
      ...(selected.action === "add" ? { expectedSourceUpdatedAt: selected.target.updatedAt } : {})
    });
    try {
      const result = await props.change(request);
      if (ownerRef.current !== identity) return;
      if (!sameChange(request, result)) setNotice("failed");
      else if (result.status === "committed" && result.render.summary.pageId === request.currentPageId) {
        restoreIntentFocusRef.current = true; setIntent(null); props.onCommitted(result.render);
      } else { restoreIntentFocusRef.current = true; setIntent(null); setNotice(result.status); }
    } catch { if (ownerRef.current === identity) { restoreIntentFocusRef.current = true; setIntent(null); setNotice("failed"); } }
    finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); } }
  };

  const candidates = results.filter((candidate) => !summary.items.some(({ sourceId }) => sourceId === candidate.sourceId));
  return <section ref={sectionRef} tabIndex={-1} aria-label={props.t("note.claimEvidence.title")}>
    <strong>{props.t("note.claimEvidence.title")}</strong><p>{props.t("note.claimEvidence.description")}</p>
    {summary.items.map((item) => <span key={item.sourceId}>{item.title}<button type="button"
      disabled={!summary.canEdit || pending || summary.items.length <= 1}
      onClick={(event) => { focusRef.current = event.currentTarget; setIntent({ action: "remove", target: item }); }}>
      {props.t("note.claimEvidence.remove")}</button></span>)}
    <span><input type="search" aria-label={props.t("note.claimEvidence.searchPlaceholder")} value={query} maxLength={160} placeholder={props.t("note.claimEvidence.searchPlaceholder")}
      onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()} onClick={(event) => {
        focusRef.current = event.currentTarget; void search();
      }}>{props.t("note.claimEvidence.search")}</button></span>
    {candidates.map((candidate) => <button key={candidate.sourceId} type="button" disabled={pending}
      onClick={(event) => { focusRef.current = event.currentTarget; setIntent({ action: "add", target: candidate }); }}>
      {props.t("note.claimEvidence.add")} {candidate.title}</button>)}
    {intent ? <div role="alertdialog" aria-label={props.t("note.claimEvidence.confirmTitle")} onKeyDown={(event) => {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault(); restoreIntentFocusRef.current = true; setIntent(null);
    }}>
      <p>{props.t(intent.action === "add" ? "note.claimEvidence.confirmAdd" : "note.claimEvidence.confirmRemove")} {intent.target.title}</p>
      <button type="button" disabled={pending} onClick={() => { restoreIntentFocusRef.current = true; setIntent(null); }}>{props.t("note.claimEvidence.cancel")}</button>
      <button ref={confirmRef} type="button" disabled={pending} onClick={() => void commit()}>{props.t("note.claimEvidence.confirm")}</button>
    </div> : null}
    {pending ? <span role="status">{props.t("note.claimEvidence.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>{props.t(`note.claimEvidence.notice.${notice}`)}</span> : null}
  </section>;
}

function identityRequest<T extends object>(props: { activeVaultId: string; note: NoteRenderResult }, renderContextId: string,
  expectedRevision: string, extra: T) {
  return { apiVersion: 1 as const, requestId: `claimevidencereq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId, renderContextId, expectedRevision, ...extra };
}
function sameSearch(request: NoteSearchClaimEvidenceRequest, result: NoteSearchClaimEvidenceResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.query === request.query;
}
function sameChange(request: NoteChangeClaimEvidenceRequest, result: NoteChangeClaimEvidenceResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.action === request.action &&
    result.sourcePageId === request.sourcePageId && result.sourceId === request.sourceId &&
    result.expectedSourceUpdatedAt === request.expectedSourceUpdatedAt;
}
