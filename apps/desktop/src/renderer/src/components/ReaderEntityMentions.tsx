import { useEffect, useRef, useState } from "react";
import type {
  NoteChangeEntityMentionRequest,
  NoteChangeEntityMentionResult,
  NoteEntityMentionItem,
  NoteRenderResult,
  NoteSearchEntityMentionsRequest,
  NoteSearchEntityMentionsResult
} from "@pige/contracts";

export function ReaderEntityMentions(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly search: (request: NoteSearchEntityMentionsRequest) => Promise<NoteSearchEntityMentionsResult>;
  readonly change: (request: NoteChangeEntityMentionRequest) => Promise<NoteChangeEntityMentionResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.entityMentions;
  const context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const busyRef = useRef(false);
  const focusRef = useRef<HTMLElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly NoteEntityMentionItem[]>([]);
  const [resultsQuery, setResultsQuery] = useState("");
  const queryRef = useRef(query);
  queryRef.current = query;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setQuery(""); setResults([]); setResultsQuery(""); setPending(false); setNotice(null); busyRef.current = false;
  }, [owner]);
  if (props.note.summary.pageType !== "entity" || !summary || !context) return null;

  const restoreFocus = (): void => {
    requestAnimationFrame(() => {
      const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
      target?.focus({ preventScroll: true });
    });
  };
  const search = async (): Promise<void> => {
    if (busyRef.current || !query.trim()) return;
    const searchQuery = query.trim();
    busyRef.current = true; setPending(true); setNotice(null);
    const identity = owner;
    const request: NoteSearchEntityMentionsRequest = {
      apiVersion: 1, requestId: requestId(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context,
      expectedRevision: summary.revision, query: searchQuery
    };
    try {
      const result = await props.search(request);
      if (ownerRef.current !== identity || queryRef.current.trim() !== searchQuery) return;
      if (result.status === "ready" && sameSearch(request, result)) {
        setResults(result.candidates);
        setResultsQuery(searchQuery);
      }
      else setNotice(result.status);
    } catch {
      if (ownerRef.current === identity && queryRef.current.trim() === searchQuery) setNotice("failed");
    }
    finally {
      if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); }
    }
  };
  const change = async (action: "add" | "remove", target: NoteEntityMentionItem): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true; setPending(true); setNotice(null);
    const identity = owner;
    const request: NoteChangeEntityMentionRequest = {
      apiVersion: 1, requestId: requestId(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context,
      expectedRevision: summary.revision, action, targetPageId: target.pageId,
      expectedTargetUpdatedAt: target.updatedAt
    };
    try {
      const result = await props.change(request);
      if (ownerRef.current !== identity) return;
      if (!sameChange(request, result)) setNotice("failed");
      else if (result.status === "committed" && result.render.summary.pageId === request.currentPageId &&
        result.render.summary.pageType === "entity") props.onCommitted(result.render);
      else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); }
    finally {
      if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); }
    }
  };
  return <section ref={sectionRef} tabIndex={-1} className="reader-entity-mentions"
    aria-label={props.t("note.entityMentions.title")}>
    <strong>{props.t("note.entityMentions.title")}</strong>
    {summary.items.map((item) => <span key={item.pageId}>{item.title}<button type="button"
      ref={(node) => { if (node) focusRef.current = node; }} disabled={!summary.canEdit || pending}
      onClick={(event) => { focusRef.current = event.currentTarget; void change("remove", item); }}>
      {props.t("note.entityMentions.remove")}
    </button></span>)}
    <span><input value={query} maxLength={160} placeholder={props.t("note.entityMentions.searchPlaceholder")}
      onChange={(event) => {
        const nextQuery = event.currentTarget.value;
        setQuery(nextQuery);
        if (nextQuery.trim() !== resultsQuery) { setResults([]); setResultsQuery(""); }
      }} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()}
        onClick={(event) => { focusRef.current = event.currentTarget; void search(); }}>
        {props.t("note.entityMentions.search")}
      </button></span>
    {results.filter((candidate) => !summary.items.some(({ pageId }) => pageId === candidate.pageId))
      .map((candidate) => <button key={candidate.pageId} type="button" disabled={pending}
        onClick={(event) => { focusRef.current = event.currentTarget; void change("add", candidate); }}>
        {props.t("note.entityMentions.add")} {candidate.title}
      </button>)}
    {pending ? <span role="status">{props.t("note.entityMentions.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>
      {props.t(`note.entityMentions.notice.${notice}`)}
    </span> : null}
  </section>;
}

function requestId(): string {
  return `entitymentionreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function sameSearch(request: NoteSearchEntityMentionsRequest, result: NoteSearchEntityMentionsResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.query === request.query;
}
function sameChange(request: NoteChangeEntityMentionRequest, result: NoteChangeEntityMentionResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.action === request.action &&
    result.targetPageId === request.targetPageId && result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}
