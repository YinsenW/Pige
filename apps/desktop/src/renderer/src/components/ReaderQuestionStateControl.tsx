import { useEffect, useRef, useState } from "react";
import type {
  NoteQuestionState,
  NoteRenderResult,
  NoteSetQuestionStateRequest,
  NoteSetQuestionStateResult
} from "@pige/contracts";

const questionStates: readonly NoteQuestionState[] = [
  "open", "partially_answered", "answered", "stale"
];

export function ReaderQuestionStateControl(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly onSetState: (request: NoteSetQuestionStateRequest) => Promise<NoteSetQuestionStateResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.questionState;
  const renderContextId = props.note.renderContextId;
  const ownerIdentity = `${props.activeVaultId}:${props.note.summary.pageId}:${renderContextId ?? ""}:${summary?.revision ?? ""}`;
  const [draft, setDraft] = useState<NoteQuestionState | null>(summary?.state ?? null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Exclude<NoteSetQuestionStateResult["status"], "committed"> | null>(null);
  const ownerIdentityRef = useRef(ownerIdentity);
  const activeRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    ownerIdentityRef.current = ownerIdentity;
    activeRef.current = false;
    setDraft(summary?.state ?? null);
    setPending(false);
    setNotice(null);
  }, [ownerIdentity, summary?.state]);

  useEffect(() => {
    if (pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
      selectRef.current?.focus({ preventScroll: true })));
  }, [pending]);

  if (props.note.summary.pageType !== "question" || !summary || !renderContextId || !draft) return null;

  const setState = async (state: NoteQuestionState): Promise<void> => {
    if (!summary.canChange || activeRef.current || state === summary.state) {
      setDraft(summary.state);
      return;
    }
    activeRef.current = true;
    const requestOwner = ownerIdentity;
    const request: NoteSetQuestionStateRequest = {
      apiVersion: 1,
      requestId: `notequestionreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId,
      renderContextId,
      expectedRevision: summary.revision,
      state
    };
    setDraft(state);
    setPending(true);
    setNotice(null);
    try {
      const result = await props.onSetState(request);
      if (ownerIdentityRef.current !== requestOwner || !sameIdentity(request, result)) return;
      if (result.status !== "committed") {
        setNotice(result.status);
        return;
      }
      if (
        result.render.summary.pageId !== request.currentPageId ||
        result.render.summary.pageType !== "question" ||
        result.render.questionState?.state !== state ||
        result.render.questionState.canChange !== true
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

  return <span className="reader-question-state">
    <label htmlFor="reader-question-state">{props.t("note.questionState.label")}</label>
    <select id="reader-question-state" ref={selectRef} value={draft}
      disabled={!summary.canChange || pending} aria-busy={pending || undefined}
      onChange={(event) => void setState(event.currentTarget.value as NoteQuestionState)}>
      {questionStates.map((state) => <option key={state} value={state}>
        {props.t(`note.questionState.value.${state}`)}
      </option>)}
    </select>
    {pending ? <span role="status">{props.t("note.questionState.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"} aria-live="polite">
      {props.t(`note.questionState.notice.${notice}`)}
    </span> : null}
  </span>;
}

function sameIdentity(
  request: NoteSetQuestionStateRequest,
  result: NoteSetQuestionStateResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId &&
    result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision &&
    result.state === request.state;
}
