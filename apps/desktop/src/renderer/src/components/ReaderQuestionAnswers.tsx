import { useEffect, useRef, useState } from "react";
import type { NoteChangeQuestionAnswerRequest, NoteChangeQuestionAnswerResult, NoteQuestionAnswerItem,
  NoteRenderResult, NoteSearchQuestionAnswersRequest, NoteSearchQuestionAnswersResult } from "@pige/contracts";

export function ReaderQuestionAnswers(props: { activeVaultId: string; note: NoteRenderResult;
  search: (request: NoteSearchQuestionAnswersRequest) => Promise<NoteSearchQuestionAnswersResult>;
  change: (request: NoteChangeQuestionAnswerRequest) => Promise<NoteChangeQuestionAnswerResult>;
  onCommitted: (render: NoteRenderResult) => void; t: (key: string) => string }): React.JSX.Element | null {
  const summary = props.note.questionAnswers, context = props.note.renderContextId;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${summary?.revision ?? ""}`;
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const busyRef = useRef(false), focusRef = useRef<HTMLElement | null>(null), sectionRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(""), [results, setResults] = useState<readonly NoteQuestionAnswerItem[]>([]);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const wasBusy = busyRef.current;
    setQuery(""); setResults([]); setPending(false); setNotice(null); busyRef.current = false;
    if (wasBusy) requestAnimationFrame(() => {
      const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
      target?.focus({ preventScroll: true });
    });
  }, [owner]);
  if (props.note.summary.pageType !== "question" || !summary || !context) return null;
  const restoreFocus = (): void => { requestAnimationFrame(() => {
    const target = focusRef.current?.isConnected ? focusRef.current : sectionRef.current;
    target?.focus({ preventScroll: true });
  }); };
  const search = async (): Promise<void> => { if (busyRef.current || !query.trim()) return; busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request = { apiVersion: 1 as const, requestId: id(), activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId,
      renderContextId: context, expectedRevision: summary.revision, query: query.trim() };
    try { const result = await props.search(request); if (ownerRef.current !== identity) return;
      if (result.status === "ready" && sameSearch(request, result)) setResults(result.candidates); else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); } finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } } };
  const change = async (action: "add" | "remove", target: NoteQuestionAnswerItem): Promise<void> => { if (busyRef.current) return; busyRef.current = true; setPending(true); setNotice(null); const identity = owner;
    const request: NoteChangeQuestionAnswerRequest = { apiVersion: 1, requestId: id(), activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId, renderContextId: context, expectedRevision: summary.revision,
      action, targetPageId: target.pageId, ...(action === "add" ? { expectedTargetUpdatedAt: target.updatedAt } : {}) };
    try { const result = await props.change(request); if (ownerRef.current !== identity) return;
      if (!sameChange(request, result)) setNotice("failed");
      else if (result.status === "committed" && result.render.summary.pageId === request.currentPageId) props.onCommitted(result.render); else setNotice(result.status);
    } catch { if (ownerRef.current === identity) setNotice("failed"); } finally { if (ownerRef.current === identity) { busyRef.current = false; setPending(false); restoreFocus(); } } };
  return <section ref={sectionRef} tabIndex={-1} className="reader-question-answers" aria-label={props.t("note.questionAnswers.title")}>
    <strong>{props.t("note.questionAnswers.title")}</strong>
    {summary.items.map((item) => <span key={item.pageId}>{item.title}<button type="button" ref={(node) => { if (node) focusRef.current = node; }} disabled={!summary.canEdit || pending} onClick={(event) => { focusRef.current = event.currentTarget; void change("remove", item); }}>{props.t("note.questionAnswers.remove")}</button></span>)}
    <span><input value={query} maxLength={160} placeholder={props.t("note.questionAnswers.searchPlaceholder")} onChange={(event) => setQuery(event.currentTarget.value)} />
      <button type="button" disabled={!summary.canEdit || pending || !query.trim()} onClick={(event) => { focusRef.current = event.currentTarget; void search(); }}>{props.t("note.questionAnswers.search")}</button></span>
    {results.filter((candidate) => !summary.items.some(({ pageId }) => pageId === candidate.pageId)).map((candidate) => <button key={candidate.pageId} type="button" disabled={pending} onClick={(event) => { focusRef.current = event.currentTarget; void change("add", candidate); }}>{props.t("note.questionAnswers.add")} {candidate.title}</button>)}
    {pending ? <span role="status">{props.t("note.questionAnswers.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"}>{props.t(`note.questionAnswers.notice.${notice}`)}</span> : null}
  </section>;
}
function id(): string { return `questionanswerreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`; }
function sameSearch(request: NoteSearchQuestionAnswersRequest, result: NoteSearchQuestionAnswersResult): boolean { return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId && result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId && result.expectedRevision === request.expectedRevision && result.query === request.query; }
function sameChange(request: NoteChangeQuestionAnswerRequest, result: NoteChangeQuestionAnswerResult): boolean { return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId && result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId && result.expectedRevision === request.expectedRevision && result.action === request.action && result.targetPageId === request.targetPageId && result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt; }
