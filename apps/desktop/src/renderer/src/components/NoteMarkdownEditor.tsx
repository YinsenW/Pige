import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
import type {
  NoteEditorInvalidReason,
  NoteEditorOpenRequest,
  NoteEditorOpenResult,
  NoteEditorSaveRequest,
  NoteEditorSaveResult
} from "@pige/contracts";

export type NoteMarkdownEditorReady = Extract<NoteEditorOpenResult, { status: "ready" }>;
export type NoteMarkdownEditorCommitted = Extract<NoteEditorSaveResult, { status: "committed" }>;

export type NoteMarkdownEditorLabels = Readonly<{
  title: string;
  field: string;
  save: string;
  saving: string;
  cancel: string;
  review: string;
  reviewing: string;
  conflictTitle: string;
  currentFile: string;
  draft: string;
  useCurrent: string;
  continueDraft: string;
  stale: string;
  failed: string;
  notFound: string;
  currentAccepted: string;
  mergeReady: string;
  invalid: Readonly<Record<NoteEditorInvalidReason, string>>;
}>;

export type NoteMarkdownEditorProps = Readonly<{
  ready: NoteMarkdownEditorReady;
  labels: NoteMarkdownEditorLabels;
  returnFocusRef: RefObject<HTMLElement | null>;
  onSave: (request: NoteEditorSaveRequest) => Promise<NoteEditorSaveResult>;
  onReload: (request: NoteEditorOpenRequest) => Promise<NoteEditorOpenResult>;
  onCommitted: (result: NoteMarkdownEditorCommitted) => void;
  onCancel: () => void;
}>;

type Notice =
  | "stale"
  | "failed"
  | "notFound"
  | "currentAccepted"
  | "mergeReady"
  | NoteEditorInvalidReason;

export function NoteMarkdownEditor(props: NoteMarkdownEditorProps): React.JSX.Element {
  const propIdentityKey = editorIdentityKey(props.ready);
  const renderedIdentityKeyRef = useRef(propIdentityKey);
  renderedIdentityKeyRef.current = propIdentityKey;
  const [base, setBase] = useState(props.ready);
  const [draft, setDraft] = useState(props.ready.markdown);
  const [conflictReview, setConflictReview] = useState<NoteMarkdownEditorReady | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<"save" | "review" | null>(null);
  const requestSequenceRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentFileRef = useRef<HTMLTextAreaElement>(null);
  const focusEditorAfterReviewRef = useRef(false);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setBase(props.ready);
    setDraft(props.ready.markdown);
    setConflictReview(null);
    setNotice(null);
    setPending(null);
    focusEditorAfterReviewRef.current = false;
  }, [propIdentityKey]);

  useEffect(() => {
    if (conflictReview) {
      currentFileRef.current?.focus();
      return;
    }
    if (focusEditorAfterReviewRef.current) {
      focusEditorAfterReviewRef.current = false;
      textareaRef.current?.focus();
    }
  }, [conflictReview]);

  const requestIsCurrent = (sequence: number, expectedPropIdentityKey: string): boolean =>
    sequence === requestSequenceRef.current &&
    renderedIdentityKeyRef.current === expectedPropIdentityKey;

  const save = async (): Promise<void> => {
    if (pending || conflictReview) return;
    const request: NoteEditorSaveRequest = {
      apiVersion: 1,
      requestId: createNoteEditorRequestId(),
      activeVaultId: base.activeVaultId,
      pageId: base.pageId,
      renderContextId: base.renderContextId,
      expectedRevision: base.revision,
      markdown: draft
    };
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const expectedPropIdentityKey = propIdentityKey;
    setPending("save");
    setNotice(null);
    try {
      const result = await props.onSave(request);
      if (!requestIsCurrent(sequence, expectedPropIdentityKey)) return;
      if (!resultMatchesRequest(request, result)) {
        setNotice("failed");
        return;
      }
      if (result.status === "committed") {
        if (
          result.render.summary.pageId !== request.pageId ||
          result.render.renderContextId === undefined
        ) {
          setNotice("failed");
          return;
        }
        props.onCommitted(result);
        return;
      }
      setConflictReview(null);
      setNotice(result.status === "not_found"
        ? "notFound"
        : result.status === "invalid"
          ? result.reason
          : result.status);
    } catch {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setNotice("failed");
    } finally {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setPending(null);
    }
  };

  const reviewConflict = async (): Promise<void> => {
    if (pending) return;
    const request: NoteEditorOpenRequest = {
      apiVersion: 1,
      requestId: createNoteEditorRequestId(),
      activeVaultId: base.activeVaultId,
      pageId: base.pageId,
      renderContextId: base.renderContextId
    };
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const expectedPropIdentityKey = propIdentityKey;
    setPending("review");
    try {
      const result = await props.onReload(request);
      if (!requestIsCurrent(sequence, expectedPropIdentityKey)) return;
      if (!resultMatchesRequest(request, result) || result.status !== "ready") {
        setNotice(result.status === "not_found" ? "notFound" : "failed");
        return;
      }
      setConflictReview(result);
      setNotice(null);
    } catch {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setNotice("failed");
    } finally {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setPending(null);
    }
  };

  const useCurrentFile = (): void => {
    if (!conflictReview || pending) return;
    setBase(conflictReview);
    setDraft(conflictReview.markdown);
    focusEditorAfterReviewRef.current = true;
    setConflictReview(null);
    setNotice("currentAccepted");
  };

  const continueWithDraft = (): void => {
    if (!conflictReview || pending) return;
    setBase(conflictReview);
    focusEditorAfterReviewRef.current = true;
    setConflictReview(null);
    setNotice("mergeReady");
  };

  const cancel = (): void => {
    requestSequenceRef.current += 1;
    props.onCancel();
    window.requestAnimationFrame(() => props.returnFocusRef.current?.focus());
  };

  const handleKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!conflictReview) void save();
    }
  };

  const noticeLabel = notice === null
    ? null
    : notice in props.labels.invalid
      ? props.labels.invalid[notice as NoteEditorInvalidReason]
      : props.labels[notice as "stale" | "failed" | "notFound" | "currentAccepted" | "mergeReady"];

  return (
    <section className="note-reader" aria-labelledby="note-markdown-editor-title">
      <header className="settings-panel-header">
        <h1 id="note-markdown-editor-title">{props.labels.title}</h1>
      </header>
      <form
        className="settings-card"
        aria-busy={pending ? "true" : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onKeyDown={handleKeyDown}
      >
        <label htmlFor="note-markdown-editor-input">
          {conflictReview ? props.labels.draft : props.labels.field}
        </label>
        <textarea
          ref={textareaRef}
          id="note-markdown-editor-input"
          value={draft}
          rows={18}
          disabled={pending !== null}
          autoFocus
          spellCheck
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setNotice(null);
          }}
        />
        {conflictReview ? (
          <section
            className="settings-card"
            aria-labelledby="note-markdown-editor-conflict-title"
          >
            <h2 id="note-markdown-editor-conflict-title">{props.labels.conflictTitle}</h2>
            <label htmlFor="note-markdown-editor-current-file">{props.labels.currentFile}</label>
            <textarea
              ref={currentFileRef}
              id="note-markdown-editor-current-file"
              value={conflictReview.markdown}
              rows={12}
              readOnly
              spellCheck={false}
            />
            <div className="settings-actions">
              <button type="button" className="settings-button" onClick={useCurrentFile}>
                {props.labels.useCurrent}
              </button>
              <button type="button" className="primary" onClick={continueWithDraft}>
                {props.labels.continueDraft}
              </button>
            </div>
          </section>
        ) : null}
        {noticeLabel ? (
          <div
            className={`settings-inline-status ${notice === "currentAccepted" || notice === "mergeReady" ? "success" : "error"}`}
            role="status"
            aria-live="polite"
          >
            <span>{noticeLabel}</span>
            {notice === "stale" ? (
              <button
                type="button"
                className="settings-button"
                disabled={pending !== null}
                onClick={() => void reviewConflict()}
              >
                {pending === "review" ? props.labels.reviewing : props.labels.review}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="settings-actions">
          <button type="submit" className="primary" disabled={pending !== null || conflictReview !== null}>
            {pending === "save" ? props.labels.saving : props.labels.save}
          </button>
          <button type="button" className="ghost" disabled={pending !== null} onClick={cancel}>
            {props.labels.cancel}
          </button>
        </div>
      </form>
    </section>
  );
}

function createNoteEditorRequestId(): `noteeditreq_${string}` {
  return `noteeditreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function resultMatchesRequest(
  request: Pick<NoteEditorOpenRequest, "requestId" | "activeVaultId" | "pageId">,
  result: NoteEditorOpenResult | NoteEditorSaveResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.pageId === request.pageId;
}

function editorIdentityKey(ready: NoteMarkdownEditorReady): string {
  return `${ready.activeVaultId}:${ready.pageId}:${ready.renderContextId}:${ready.revision}`;
}
