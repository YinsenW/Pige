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
  reload: string;
  reloading: string;
  stale: string;
  failed: string;
  notFound: string;
  reloaded: string;
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

type Notice = "stale" | "failed" | "notFound" | "reloaded" | NoteEditorInvalidReason;

export function NoteMarkdownEditor(props: NoteMarkdownEditorProps): React.JSX.Element {
  const propIdentityKey = editorIdentityKey(props.ready);
  const renderedIdentityKeyRef = useRef(propIdentityKey);
  renderedIdentityKeyRef.current = propIdentityKey;
  const [base, setBase] = useState(props.ready);
  const [draft, setDraft] = useState(props.ready.markdown);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<"save" | "reload" | null>(null);
  const requestSequenceRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setBase(props.ready);
    setDraft(props.ready.markdown);
    setNotice(null);
    setPending(null);
  }, [propIdentityKey]);

  const requestIsCurrent = (sequence: number, expectedPropIdentityKey: string): boolean =>
    sequence === requestSequenceRef.current &&
    renderedIdentityKeyRef.current === expectedPropIdentityKey;

  const save = async (): Promise<void> => {
    if (pending) return;
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

  const reload = async (): Promise<void> => {
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
    setPending("reload");
    try {
      const result = await props.onReload(request);
      if (!requestIsCurrent(sequence, expectedPropIdentityKey)) return;
      if (!resultMatchesRequest(request, result) || result.status !== "ready") {
        setNotice(result.status === "not_found" ? "notFound" : "failed");
        return;
      }
      setBase(result);
      setNotice("reloaded");
      textareaRef.current?.focus();
    } catch {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setNotice("failed");
    } finally {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setPending(null);
    }
  };

  const cancel = (): void => {
    requestSequenceRef.current += 1;
    props.onCancel();
    window.requestAnimationFrame(() => props.returnFocusRef.current?.focus());
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  const noticeLabel = notice === null
    ? null
    : notice in props.labels.invalid
      ? props.labels.invalid[notice as NoteEditorInvalidReason]
      : props.labels[notice as "stale" | "failed" | "notFound" | "reloaded"];

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
      >
        <label htmlFor="note-markdown-editor-input">{props.labels.field}</label>
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
          onKeyDown={handleKeyDown}
        />
        {noticeLabel ? (
          <div
            className={`settings-inline-status ${notice === "reloaded" ? "success" : "error"}`}
            role="status"
            aria-live="polite"
          >
            <span>{noticeLabel}</span>
            {notice === "stale" ? (
              <button type="button" className="settings-button" onClick={() => void reload()}>
                {pending === "reload" ? props.labels.reloading : props.labels.reload}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="settings-actions">
          <button type="submit" className="primary" disabled={pending !== null}>
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
