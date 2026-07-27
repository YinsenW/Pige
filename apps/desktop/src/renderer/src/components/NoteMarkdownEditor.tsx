import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";

export type NoteMarkdownEditorBaseIdentity = Readonly<{
  activeVaultId: string;
  pageId: string;
  revisionId: string;
}>;

export type NoteMarkdownEditorSaveRequest = Readonly<{
  base: NoteMarkdownEditorBaseIdentity;
  markdown: string;
}>;

export type NoteMarkdownEditorSaveResult =
  | Readonly<{ status: "saved"; identity: NoteMarkdownEditorBaseIdentity }>
  | Readonly<{ status: "stale" | "conflict" | "failed" }>;

export type NoteMarkdownEditorReloadResult =
  | Readonly<{ status: "ready"; identity: NoteMarkdownEditorBaseIdentity }>
  | Readonly<{ status: "not_found" | "failed" }>;

export type NoteMarkdownEditorLabels = Readonly<{
  title: string;
  field: string;
  save: string;
  saving: string;
  cancel: string;
  reload: string;
  reloading: string;
  stale: string;
  conflict: string;
  failed: string;
  reloaded: string;
}>;

export type NoteMarkdownEditorProps = Readonly<{
  identity: NoteMarkdownEditorBaseIdentity;
  initialMarkdown: string;
  labels: NoteMarkdownEditorLabels;
  returnFocusRef: RefObject<HTMLElement | null>;
  onSave: (request: NoteMarkdownEditorSaveRequest) => Promise<NoteMarkdownEditorSaveResult>;
  onReload: (base: NoteMarkdownEditorBaseIdentity) => Promise<NoteMarkdownEditorReloadResult>;
  onSaved: (identity: NoteMarkdownEditorBaseIdentity) => void;
  onCancel: () => void;
}>;

type Notice = "stale" | "conflict" | "failed" | "reloaded";

export function NoteMarkdownEditor(props: NoteMarkdownEditorProps): React.JSX.Element {
  const propIdentityKey = identityKey(props.identity);
  const renderedIdentityKeyRef = useRef(propIdentityKey);
  renderedIdentityKeyRef.current = propIdentityKey;
  const [base, setBase] = useState(props.identity);
  const [draft, setDraft] = useState(props.initialMarkdown);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<"save" | "reload" | null>(null);
  const requestSequenceRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setBase(props.identity);
    setDraft(props.initialMarkdown);
    setNotice(null);
    setPending(null);
  }, [propIdentityKey]);

  const requestIsCurrent = (sequence: number, expectedPropIdentityKey: string): boolean =>
    sequence === requestSequenceRef.current &&
    renderedIdentityKeyRef.current === expectedPropIdentityKey;

  const save = async (): Promise<void> => {
    if (pending) return;
    const request: NoteMarkdownEditorSaveRequest = {
      base: { ...base },
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
      if (result.status === "saved") {
        if (!sameNoteOwner(request.base, result.identity)) {
          setNotice("failed");
          return;
        }
        props.onSaved(result.identity);
        return;
      }
      setNotice(result.status);
    } catch {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setNotice("failed");
    } finally {
      if (requestIsCurrent(sequence, expectedPropIdentityKey)) setPending(null);
    }
  };

  const reload = async (): Promise<void> => {
    if (pending) return;
    const requestedBase = { ...base };
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const expectedPropIdentityKey = propIdentityKey;
    setPending("reload");
    try {
      const result = await props.onReload(requestedBase);
      if (!requestIsCurrent(sequence, expectedPropIdentityKey)) return;
      if (result.status !== "ready" || !sameNoteOwner(requestedBase, result.identity)) {
        setNotice("failed");
        return;
      }
      setBase(result.identity);
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
    const returnFocus = props.returnFocusRef.current;
    props.onCancel();
    returnFocus?.ownerDocument.defaultView?.requestAnimationFrame(() => returnFocus.focus());
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
        {notice ? (
          <div
            className={`settings-inline-status ${notice === "reloaded" ? "success" : "error"}`}
            role="status"
            aria-live="polite"
          >
            <span>{props.labels[notice]}</span>
            {notice === "stale" || notice === "conflict" ? (
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
          <button type="button" className="ghost" onClick={cancel}>
            {props.labels.cancel}
          </button>
        </div>
      </form>
    </section>
  );
}

function sameNoteOwner(
  left: NoteMarkdownEditorBaseIdentity,
  right: NoteMarkdownEditorBaseIdentity
): boolean {
  return left.activeVaultId === right.activeVaultId && left.pageId === right.pageId;
}

function identityKey(identity: NoteMarkdownEditorBaseIdentity): string {
  return `${identity.activeVaultId}:${identity.pageId}:${identity.revisionId}`;
}
