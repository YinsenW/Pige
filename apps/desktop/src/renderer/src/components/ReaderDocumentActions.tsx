import { useEffect, useRef, useState } from "react";
import { PigeIcon } from "./PigeIcon";

export type ReaderDocumentTrashOutcome = "committed" | "retained";

export interface ReaderDocumentActionLabels {
  readonly more: string;
  readonly menu: string;
  readonly moveToTrash: string;
  readonly title: string;
  readonly description: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly pending: string;
  readonly failed: string;
}

export interface ReaderDocumentActionsProps {
  readonly ownerIdentity: string;
  readonly canMoveToTrash: boolean;
  readonly labels: ReaderDocumentActionLabels;
  readonly onMoveToTrash: () => Promise<ReaderDocumentTrashOutcome>;
  readonly onCommitted: () => void;
}

export function ReaderDocumentActions(props: ReaderDocumentActionsProps): React.JSX.Element | null {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  ownerIdentityRef.current = props.ownerIdentity;

  useEffect(() => {
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setMenuOpen(false);
    setConfirmOpen(false);
    setPending(false);
    setFailed(false);
  }, [props.ownerIdentity, props.canMoveToTrash]);

  useEffect(() => {
    if (menuOpen) actionRef.current?.focus({ preventScroll: true });
  }, [menuOpen]);

  useEffect(() => {
    if (confirmOpen) cancelRef.current?.focus({ preventScroll: true });
  }, [confirmOpen]);

  if (!props.canMoveToTrash) return null;

  const restoreTriggerFocus = (): void => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const cancel = (): void => {
    if (requestActiveRef.current) return;
    setConfirmOpen(false);
    setFailed(false);
    restoreTriggerFocus();
  };

  const submit = async (): Promise<void> => {
    if (requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const ownerIdentity = props.ownerIdentity;
    setPending(true);
    setFailed(false);
    try {
      const outcome = await props.onMoveToTrash();
      if (sequence !== requestSequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      if (outcome === "committed") {
        setConfirmOpen(false);
        props.onCommitted();
        return;
      }
      setFailed(true);
      window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    } catch {
      if (sequence === requestSequenceRef.current && ownerIdentity === ownerIdentityRef.current) {
        setFailed(true);
        window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
      }
    } finally {
      if (sequence === requestSequenceRef.current && ownerIdentity === ownerIdentityRef.current) {
        requestActiveRef.current = false;
        setPending(false);
      }
    }
  };

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="icon-button"
      data-reader-action="more"
      aria-label={props.labels.more}
      title={props.labels.more}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-controls="reader-document-actions-menu"
      onClick={() => setMenuOpen((current) => !current)}
    >
      <PigeIcon name="more" size={16} />
    </button>
    {menuOpen ? (
      <div
        id="reader-document-actions-menu"
        className="selection-more-menu below"
        role="menu"
        aria-label={props.labels.menu}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setMenuOpen(false);
          restoreTriggerFocus();
        }}
      >
        <button
          ref={actionRef}
          type="button"
          role="menuitem"
          onClick={() => {
            setMenuOpen(false);
            setConfirmOpen(true);
            setFailed(false);
          }}
        >
          {props.labels.moveToTrash}
        </button>
      </div>
    ) : null}
    {confirmOpen ? (
      <div className="confirmation-backdrop">
        <section
          ref={dialogRef}
          className="confirmation-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reader-document-trash-title"
          aria-describedby="reader-document-trash-description"
          aria-busy={pending}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) {
              event.preventDefault();
              cancel();
              return;
            }
            if (event.key !== "Tab") return;
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            if (controls.length === 0) return event.preventDefault();
            const first = controls[0]!;
            const last = controls.at(-1)!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <div className="confirmation-icon" aria-hidden="true">!</div>
          <div className="confirmation-copy">
            <h2 id="reader-document-trash-title">{props.labels.title}</h2>
            <p id="reader-document-trash-description">{props.labels.description}</p>
          </div>
          {failed ? <p className="error" role="alert">{props.labels.failed}</p> : null}
          <div className="confirmation-actions">
            <button ref={cancelRef} type="button" className="secondary" disabled={pending} onClick={cancel}>
              {props.labels.cancel}
            </button>
            <button type="button" className="primary" disabled={pending} onClick={() => void submit()}>
              {pending ? props.labels.pending : props.labels.confirm}
            </button>
          </div>
        </section>
      </div>
    ) : null}
  </>;
}
