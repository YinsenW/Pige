import { useEffect, useRef, useState } from "react";
import type {
  NoteChangeClaimContradictionRequest,
  NoteChangeClaimContradictionResult,
  NoteClaimContradictionItem,
  NoteRenderResult,
  NoteSearchClaimContradictionsRequest,
  NoteSearchClaimContradictionsResult
} from "@pige/contracts";

type Intent = { readonly action: "add" | "remove"; readonly target: NoteClaimContradictionItem };

export function ReaderClaimContradictions(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly search: (request: NoteSearchClaimContradictionsRequest) => Promise<NoteSearchClaimContradictionsResult>;
  readonly change: (request: NoteChangeClaimContradictionRequest) => Promise<NoteChangeClaimContradictionResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.claimContradictions, context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const busyRef = useRef(false), focusRef = useRef<HTMLElement | null>(null), sectionRef = useRef<HTMLElement>(null), confirmRef = useRef<HTMLButtonElement>(null), restoreIntentFocusRef = useRef(false);
  const [query, setQuery] = useState(""), [results, setResults] = useState<readonly NoteClaimContradictionItem[]>([]);
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
    const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
    target?.focus({ preventScroll: true });
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
    const request: NoteChangeClaimContradictionRequest = identityRequest(props, context, summary.revision, {
      action: selected.action,
      targetPageId: selected.target.pageId,
      ...(selected.action === "add" ? { expectedTargetUpdatedAt: selected.target.updatedAt } : {})
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

  const candidates = results.filter((candidate) => !summary.items.some(({ pageId }) => pageId === candidate.pageId));
  return <section ref={sectionRef} tabIndex={-1} aria-label={props.t("note.claimContradictions.title")}>
    <strong>{props.t("note.claimContradictions.title")}</strong>
    <p>{props.t("note.claimContradictions.description")}</p>
    {summary.items.map((item) => <span key={item.pageId}>{item.title}<button type="button"
      disabled={!summary.canEdit || pending} onClick={(event) => { focusRef.current = event.currentTarget; setIntent({ action: "remove", target: item }); }}>
      {props.t("note.claimContradictions.remove")}</button></span>)}
    <span><input value={query} maxLength={160} placeholder={props.t("note.claimContradictions.searchPlaceholder")}
      onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()} onClick={(event) => {
        focusRef.current = event.currentTarget; void search();
      }}>{props.t("note.claimContradictions.search")}</button></span>
    {candidates.map((candidate) => <button key={candidate.pageId} type="button" disabled={pending} onClick={(event) => {
      focusRef.current = event.currentTarget; setIntent({ action: "add", target: candidate });
    }}>{props.t("note.claimContradictions.add")} {candidate.title}</button>)}
    {intent ? <div role="alertdialog" aria-label={props.t("note.claimContradictions.confirmTitle")}>
      <p>{props.t(intent.action === "add" ? "note.claimContradictions.confirmAdd" : "note.claimContradictions.confirmRemove")} {intent.target.title}</p>
      <button type="button" disabled={pending} onClick={() => { restoreIntentFocusRef.current = true; setIntent(null); }}>{props.t("note.claimContradictions.cancel")}</button>
      <button ref={confirmRef} type="button" disabled={pending} onClick={() => void commit()}>{props.t("note.claimContradictions.confirm")}</button>
    </div> : null}
    {pending ? <span role="status">{props.t("note.claimContradictions.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>{props.t(`note.claimContradictions.notice.${notice}`)}</span> : null}
  </section>;
}

function requestId(): string {
  return `claimcontradictionreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function identityRequest<T extends object>(props: { activeVaultId: string; note: NoteRenderResult }, renderContextId: string,
  expectedRevision: string, extra: T) {
  return { apiVersion: 1 as const, requestId: requestId(), activeVaultId: props.activeVaultId,
    currentPageId: props.note.summary.pageId, renderContextId, expectedRevision, ...extra };
}
function sameSearch(request: NoteSearchClaimContradictionsRequest, result: NoteSearchClaimContradictionsResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.query === request.query;
}
function sameChange(request: NoteChangeClaimContradictionRequest, result: NoteChangeClaimContradictionResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.action === request.action &&
    result.targetPageId === request.targetPageId && result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}
