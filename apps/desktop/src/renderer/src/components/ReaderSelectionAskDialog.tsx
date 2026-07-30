import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MutableRefObject
} from "react";
import type {
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionIdentity
} from "@pige/contracts";
import {
  READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS,
  READER_SELECTION_ASK_QUESTION_MAX_UTF8_BYTES,
  type Locale
} from "@pige/schemas";

export function createReaderSelectionAgentTurnId(now = new Date()): string {
  const date = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
    .map((part) => part.toString().padStart(2, "0")).join("");
  return `turn_${date}_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function createReaderSelectionActionRequestId(): string {
  return `readerselaction_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export function useReaderSelectionAskState(
  focusTransitionRef: MutableRefObject<boolean>,
  returnFocus: () => void
) {
  const [current, setCurrent] = useState<{ readonly selection: ReaderSelectionIdentity; readonly open: boolean } | null>(null);
  return {
    current,
    open: (selection: ReaderSelectionIdentity): void => {
      focusTransitionRef.current = true;
      setCurrent({ selection, open: true });
    },
    close: (): void => {
      setCurrent((value) => value ? { ...value, open: false } : null);
      window.requestAnimationFrame(() => {
        returnFocus();
        window.requestAnimationFrame(() => { focusTransitionRef.current = false; });
      });
    },
    clear: (): void => {
      focusTransitionRef.current = false;
      setCurrent(null);
    }
  };
}

export interface ReaderSelectionAskDialogProps {
  readonly identityKey: string;
  readonly open: boolean;
  readonly selection: ReaderSelectionIdentity | null;
  readonly locale: Locale;
  readonly position: CSSProperties;
  readonly onSubmitAction: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
  readonly onActionResult: (result: ReaderSelectionActionResult) => void;
  readonly onSent: () => void;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}

export function ReaderSelectionAskDialog(props: ReaderSelectionAskDialogProps): React.JSX.Element | null {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setQuestion("");
    setPending(false);
    setFailed(false);
  }, [props.identityKey]);

  useEffect(() => {
    if (!props.open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [props.open]);

  const restoreInputFocus = (): void => {
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || composingRef.current || requestActiveRef.current) {
      restoreInputFocus();
      return;
    }
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const identityKey = props.identityKey;
    setPending(true);
    setFailed(false);
    try {
      if (!props.selection) throw new Error("Reader selection is unavailable.");
      const request: ReaderSelectionActionRequest = {
        apiVersion: 1,
        requestId: createReaderSelectionActionRequestId(),
        action: "ask",
        question: submittedQuestion,
        selection: props.selection,
        locale: props.locale,
        clientTurnId: createReaderSelectionAgentTurnId()
      };
      const result = await props.onSubmitAction(request);
      if (sequence !== requestSequenceRef.current || identityKey !== props.identityKey || result.requestId !== request.requestId) return;
      if (result.status === "completed" || result.status === "waiting") {
        setQuestion("");
        props.onActionResult(result);
        props.onSent();
      } else {
        setFailed(true);
        restoreInputFocus();
      }
    } catch {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        setFailed(true);
        restoreInputFocus();
      }
    } finally {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        requestActiveRef.current = false;
        setPending(false);
      }
    }
  };

  if (!props.open) return null;
  const titleId = "reader-selection-ask-title";
  const descriptionId = "reader-selection-ask-description";
  return <div className="selection-toolbar visible" role="dialog" aria-modal="false"
    aria-labelledby={titleId} aria-describedby={descriptionId} style={props.position}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || pending) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCancel();
    }}>
    <form onSubmit={(event) => void submit(event)}>
      <strong id={titleId}>{props.t("note.selection.askTitle")}</strong>
      <span id={descriptionId}>{props.t("note.selection.askDescription")}</span>
      <label htmlFor="reader-selection-ask-question">{props.t("note.selection.askQuestion")}</label>
      <input ref={inputRef} id="reader-selection-ask-question" className="settings-input" type="text"
        value={question} maxLength={READER_SELECTION_ASK_QUESTION_MAX_UTF8_BYTES} required disabled={pending}
        placeholder={props.t("note.selection.askPlaceholder")}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onChange={(event) => {
          const value = event.target.value;
          if (Array.from(value).length > READER_SELECTION_ASK_QUESTION_MAX_CODE_POINTS ||
            new TextEncoder().encode(value).byteLength > READER_SELECTION_ASK_QUESTION_MAX_UTF8_BYTES) return;
          setQuestion(value);
          setFailed(false);
        }} />
      <div className="settings-row-control">
        <button className="settings-button primary" type="submit" disabled={pending || !question.trim()}
          aria-busy={pending || undefined}>{pending ? props.t("note.selection.askPending") : props.t("note.selection.askSubmit")}</button>
        <button className="settings-button" type="button" disabled={pending} onClick={props.onCancel}>
          {props.t("note.selection.askCancel")}
        </button>
      </div>
      {failed ? <span className="error" role="alert" aria-live="polite">{props.t("note.selection.actionFailed")}</span> : null}
    </form>
  </div>;
}
