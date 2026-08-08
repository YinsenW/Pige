import { useEffect, useRef, useState } from "react";
import type {
  NoteChangeConceptParentRequest,
  NoteChangeConceptParentResult,
  NoteConceptParentItem,
  NoteRenderResult,
  NoteSearchConceptParentsRequest,
  NoteSearchConceptParentsResult
} from "@pige/contracts";

export function ReaderConceptParents(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly search: (request: NoteSearchConceptParentsRequest) => Promise<NoteSearchConceptParentsResult>;
  readonly change: (request: NoteChangeConceptParentRequest) => Promise<NoteChangeConceptParentResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.conceptParents, context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const busyRef = useRef(false), focusRef = useRef<HTMLElement | null>(null), restoreFocusRef = useRef(false), sectionRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(""), [results, setResults] = useState<readonly NoteConceptParentItem[]>([]);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const wasBusy = busyRef.current;
    const wasFocused = focusRef.current?.isConnected === true && document.activeElement === focusRef.current;
    setQuery(""); setResults([]); setPending(false); setNotice(null); busyRef.current = false;
    if (wasBusy || wasFocused) restoreFocusRef.current = true;
  }, [owner]);
  useEffect(() => {
    if (pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    requestAnimationFrame(() => {
      const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
      target?.focus({ preventScroll: true });
    });
  }, [pending]);
  if (props.note.summary.pageType !== "concept" || !summary || !context) return null;

  const restoreFocus = (): void => { requestAnimationFrame(() => {
    const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
    target?.focus({ preventScroll: true });
  }); };
  const search = async (): Promise<void> => {
    if (busyRef.current || !query.trim()) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request: NoteSearchConceptParentsRequest = {
      apiVersion: 1, requestId: id(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context,
      expectedRevision: summary.revision, query: query.trim()
    };
    try {
      const result = await props.search(request);
      if (ownerRef.current !== identity) return;
      if (result.status === "ready" && sameSearch(request, result)) setResults(result.candidates);
      else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); }
    finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } }
  };
  const change = async (action: "add" | "remove", target: NoteConceptParentItem): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request: NoteChangeConceptParentRequest = {
      apiVersion: 1, requestId: id(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context,
      expectedRevision: summary.revision, action, targetPageId: target.pageId,
      ...(action === "add" ? { expectedTargetUpdatedAt: target.updatedAt } : {})
    };
    try {
      const result = await props.change(request);
      if (ownerRef.current !== identity) return;
      if (!sameChange(request, result)) setNotice("failed");
      else if (result.status === "committed" && result.render.summary.pageId === request.currentPageId) {
        props.onCommitted(result.render);
      } else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); }
    finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } }
  };

  return <section ref={sectionRef} tabIndex={-1} className="reader-concept-parents" aria-label={props.t("note.conceptParents.title")}>
    <strong>{props.t("note.conceptParents.title")}</strong>
    <p>{props.t("note.conceptParents.description")}</p>
    {summary.items.map((item) => <span key={item.pageId}>{item.title}<button type="button" ref={(node) => { if (node) focusRef.current = node; }}
      disabled={!summary.canEdit || pending} onClick={(event) => { focusRef.current = event.currentTarget; void change("remove", item); }}>
      {props.t("note.conceptParents.remove")}</button></span>)}
    <span><input value={query} maxLength={160} placeholder={props.t("note.conceptParents.searchPlaceholder")}
      onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()} onClick={(event) => {
        focusRef.current = event.currentTarget; void search();
      }}>{props.t("note.conceptParents.search")}</button></span>
    {results.filter((candidate) => !summary.items.some(({ pageId }) => pageId === candidate.pageId)).map((candidate) =>
      <button key={candidate.pageId} type="button" disabled={pending} onClick={(event) => {
        focusRef.current = event.currentTarget; void change("add", candidate);
      }}>{props.t("note.conceptParents.add")} {candidate.title}</button>)}
    {pending ? <span role="status">{props.t("note.conceptParents.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>{props.t(`note.conceptParents.notice.${notice}`)}</span> : null}
  </section>;
}

function id(): `conceptparentreq_${string}` {
  return `conceptparentreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function sameSearch(request: NoteSearchConceptParentsRequest, result: NoteSearchConceptParentsResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.query === request.query;
}
function sameChange(request: NoteChangeConceptParentRequest, result: NoteChangeConceptParentResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.action === request.action &&
    result.targetPageId === request.targetPageId && result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}
