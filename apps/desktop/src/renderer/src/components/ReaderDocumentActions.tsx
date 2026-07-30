import { useEffect, useRef, useState } from "react";
import { PigeIcon } from "./PigeIcon";
import {
  ReaderNoteMergeDialog,
  type ReaderNoteMergeLabels,
  type ReaderNoteMergeOutcome,
  type ReaderNoteMergeTarget
} from "./ReaderNoteMergeDialog";

export type ReaderDocumentTrashOutcome = "committed" | "retained";
export type ReaderDocumentArchiveOutcome =
  | { readonly status: "committed"; readonly render: import("@pige/contracts").NoteRenderResult }
  | { readonly status: "retained" };

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

export interface ReaderDocumentArchiveLabels {
  readonly action: string;
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
  readonly canMerge: boolean;
  readonly canArchive?: boolean;
  readonly currentTitle: string;
  readonly labels: ReaderDocumentActionLabels;
  readonly mergeLabels: ReaderNoteMergeLabels;
  readonly archiveLabels?: ReaderDocumentArchiveLabels;
  readonly onMoveToTrash: () => Promise<ReaderDocumentTrashOutcome>;
  readonly onLoadMergeTargets: () => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onMerge: (target: ReaderNoteMergeTarget) => Promise<ReaderNoteMergeOutcome>;
  readonly onArchive?: () => Promise<ReaderDocumentArchiveOutcome>;
  readonly onCommitted: () => void;
  readonly onMergeCommitted: (render: import("@pige/contracts").NoteRenderResult) => void;
  readonly onArchiveCommitted?: (render: import("@pige/contracts").NoteRenderResult) => void;
}

export function ReaderDocumentActions(props: ReaderDocumentActionsProps): React.JSX.Element | null {
  const canArchive = props.canArchive === true && Boolean(props.archiveLabels && props.onArchive);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"trash" | "archive" | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const archiveActionRef = useRef<HTMLButtonElement>(null);
  const mergeActionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  ownerIdentityRef.current = props.ownerIdentity;

  useEffect(() => {
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setMenuOpen(false);
    setConfirmAction(null);
    setMergeOpen(false);
    setPending(false);
    setFailed(false);
  }, [props.ownerIdentity, props.canMoveToTrash, props.canMerge, canArchive]);

  useEffect(() => {
    if (menuOpen) {
      (props.canMerge
        ? mergeActionRef.current
        : canArchive
          ? archiveActionRef.current
          : actionRef.current)?.focus({ preventScroll: true });
    }
  }, [menuOpen]);

  useEffect(() => {
    if (confirmAction) cancelRef.current?.focus({ preventScroll: true });
  }, [confirmAction]);

  if (!props.canMoveToTrash && !props.canMerge && !canArchive) return null;

  const restoreTriggerFocus = (): void => {
    window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const cancel = (): void => {
    if (requestActiveRef.current) return;
    setConfirmAction(null);
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
      const outcome = confirmAction === "archive" && props.onArchive
        ? await props.onArchive()
        : await props.onMoveToTrash();
      if (sequence !== requestSequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      if (confirmAction === "archive" && typeof outcome === "object" && outcome.status === "committed") {
        setConfirmAction(null);
        props.onArchiveCommitted?.(outcome.render);
        return;
      }
      if (outcome === "committed") {
        setConfirmAction(null);
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
        {props.canMerge ? (
          <button
            ref={mergeActionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setMergeOpen(true);
            }}
          >
            {props.mergeLabels.title}
          </button>
        ) : null}
        {canArchive && props.archiveLabels ? (
          <button
            ref={archiveActionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmAction("archive");
              setFailed(false);
            }}
          >
            {props.archiveLabels.action}
          </button>
        ) : null}
        {props.canMoveToTrash ? (
          <button
            ref={actionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmAction("trash");
              setFailed(false);
            }}
          >
            {props.labels.moveToTrash}
          </button>
        ) : null}
      </div>
    ) : null}
    {mergeOpen ? (
      <ReaderNoteMergeDialog
        ownerIdentity={props.ownerIdentity}
        currentTitle={props.currentTitle}
        returnFocusRef={triggerRef}
        labels={props.mergeLabels}
        onLoadTargets={props.onLoadMergeTargets}
        onMerge={props.onMerge}
        onCancel={() => setMergeOpen(false)}
        onCommitted={(render) => {
          setMergeOpen(false);
          props.onMergeCommitted(render);
        }}
      />
    ) : null}
    {confirmAction ? (
      <div className="confirmation-backdrop">
        <section
          ref={dialogRef}
          className="confirmation-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`reader-document-${confirmAction}-title`}
          aria-describedby={`reader-document-${confirmAction}-description`}
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
            <h2 id={`reader-document-${confirmAction}-title`}>
              {confirmAction === "archive" ? props.archiveLabels?.title : props.labels.title}
            </h2>
            <p id={`reader-document-${confirmAction}-description`}>
              {confirmAction === "archive" ? props.archiveLabels?.description : props.labels.description}
            </p>
          </div>
          {failed ? <p className="error" role="alert">
            {confirmAction === "archive" ? props.archiveLabels?.failed : props.labels.failed}
          </p> : null}
          <div className="confirmation-actions">
            <button ref={cancelRef} type="button" className="secondary" disabled={pending} onClick={cancel}>
              {confirmAction === "archive" ? props.archiveLabels?.cancel : props.labels.cancel}
            </button>
            <button type="button" className="primary" disabled={pending} onClick={() => void submit()}>
              {pending
                ? confirmAction === "archive" ? props.archiveLabels?.pending : props.labels.pending
                : confirmAction === "archive" ? props.archiveLabels?.confirm : props.labels.confirm}
            </button>
          </div>
        </section>
      </div>
    ) : null}
  </>;
}
