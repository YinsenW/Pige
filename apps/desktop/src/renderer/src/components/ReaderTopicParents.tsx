import { useEffect, useRef, useState } from "react";
import type {
  NoteChangeTopicParentRequest,
  NoteChangeTopicParentResult,
  NoteRenderResult,
  NoteSearchTopicParentsRequest,
  NoteSearchTopicParentsResult,
  NoteTopicParentItem
} from "@pige/contracts";

export function ReaderTopicParents(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly search: (request: NoteSearchTopicParentsRequest) => Promise<NoteSearchTopicParentsResult>;
  readonly change: (request: NoteChangeTopicParentRequest) => Promise<NoteChangeTopicParentResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.topicParents;
  const context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner), busyRef = useRef(false), focusRef = useRef<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(""), [results, setResults] = useState<readonly NoteTopicParentItem[]>([]);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  ownerRef.current = owner;
  useEffect(() => {
    busyRef.current = false;
    setQuery(""); setResults([]); setPending(false); setNotice(null);
  }, [owner]);
  if (!summary || !context || props.note.summary.pageType !== "topic") return null;
  const restoreFocus = (): void => { window.setTimeout(() => {
    const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
    target?.focus({ preventScroll: true });
  }); };
  const search = async (): Promise<void> => {
    if (busyRef.current || !query.trim()) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request: NoteSearchTopicParentsRequest = {
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
  const change = async (action: "add" | "remove", target: NoteTopicParentItem): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request: NoteChangeTopicParentRequest = {
      apiVersion: 1, requestId: id(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context,
      expectedRevision: summary.revision, action, targetPageId: target.pageId,
      ...(action === "add" ? { expectedTargetUpdatedAt: target.updatedAt } : {})
    };
    try {
      const result = await props.change(request);
      if (ownerRef.current !== identity) return;
      if (!sameChange(request, result)) setNotice("failed");
      else if (result.status === "committed" && result.render.summary.pageId === request.currentPageId &&
        result.render.summary.pageType === "topic") props.onCommitted(result.render);
      else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); }
    finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } }
  };

  return <section ref={sectionRef} tabIndex={-1} className="reader-topic-parents" aria-label={props.t("note.topicParents.title")}>
    <strong>{props.t("note.topicParents.title")}</strong>
    <p>{props.t("note.topicParents.description")}</p>
    {summary.items.map((item) => <span key={item.pageId}>{item.title}<button type="button"
      disabled={!summary.canEdit || pending} onClick={(event) => { focusRef.current = event.currentTarget; void change("remove", item); }}>
      {props.t("note.topicParents.remove")}</button></span>)}
    <span><input value={query} maxLength={160} placeholder={props.t("note.topicParents.searchPlaceholder")}
      onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()} onClick={(event) => {
        focusRef.current = event.currentTarget; void search();
      }}>{props.t("note.topicParents.search")}</button></span>
    {results.filter((candidate) => !summary.items.some(({ pageId }) => pageId === candidate.pageId)).map((candidate) =>
      <button key={candidate.pageId} type="button" disabled={pending} onClick={(event) => {
        focusRef.current = event.currentTarget; void change("add", candidate);
      }}>{props.t("note.topicParents.add")} {candidate.title}</button>)}
    {pending ? <span role="status">{props.t("note.topicParents.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>{props.t(`note.topicParents.notice.${notice}`)}</span> : null}
  </section>;
}

function id(): `topicparentreq_${string}` {
  return `topicparentreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function sameSearch(request: NoteSearchTopicParentsRequest, result: NoteSearchTopicParentsResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.query === request.query;
}
function sameChange(request: NoteChangeTopicParentRequest, result: NoteChangeTopicParentResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.action === request.action &&
    result.targetPageId === request.targetPageId && result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}
