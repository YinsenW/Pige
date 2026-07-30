import { useEffect, useRef, useState } from "react";
import type {
  NoteArchiveCurrentRequest,
  NoteArchiveCurrentResult,
  NoteRenderResult,
  NoteRestoreArchivedRequest,
  NoteRestoreArchivedResult,
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";
import {
  ReaderNoteMergeDialog,
  type ReaderNoteMergeLabels,
  type ReaderNoteMergeOutcome,
  type ReaderNoteMergeTarget
} from "./ReaderNoteMergeDialog";
import {
  ReaderNoteRelateDialog,
  type ReaderNoteRelateLabels,
  type ReaderNoteRelateOutcome,
} from "./ReaderNoteRelateDialog";

export type ReaderDocumentTrashOutcome = "committed" | "retained";
export type ReaderDocumentArchiveOutcome =
  | { readonly status: "committed"; readonly render: NoteRenderResult }
  | { readonly status: "retained" };
export type ReaderNoteArchiveSubmit = (request: NoteArchiveCurrentRequest) => Promise<NoteArchiveCurrentResult>;
export type ReaderDocumentRestoreOutcome =
  | { readonly status: "committed"; readonly render: NoteRenderResult }
  | { readonly status: "retained" };
export type ReaderNoteRestoreSubmit = (request: NoteRestoreArchivedRequest) => Promise<NoteRestoreArchivedResult>;

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

export type ReaderDocumentRestoreLabels = ReaderDocumentArchiveLabels;

export async function submitReaderNoteArchive(input: {
  readonly note: NoteRenderResult | null | undefined;
  readonly activeVaultId: string | null | undefined;
  readonly submit: ReaderNoteArchiveSubmit | null | undefined;
  readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderDocumentArchiveOutcome> {
  const eligibility = input.note?.archiveEligibility;
  const renderContextId = input.note?.renderContextId;
  if (!input.note || !eligibility?.canArchive || !input.activeVaultId || !renderContextId || !input.submit) {
    return { status: "retained" };
  }
  const request: NoteArchiveCurrentRequest = {
    apiVersion: 1,
    requestId: `notearchivereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId,
    currentPageId: input.note.summary.pageId,
    renderContextId,
    expectedRevision: eligibility.revision
  };
  try {
    const result = await input.submit(request);
    if (
      !archiveIdentityMatches(request, result) ||
      (input.currentNote && !archiveRequestMatchesNote(request, input.currentNote())) ||
      result.status !== "committed" ||
      result.render.summary.pageId !== request.currentPageId ||
      result.render.summary.status !== "archived"
    ) return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch {
    return { status: "retained" };
  }
}

export async function submitReaderNoteRestore(input: {
  readonly note: NoteRenderResult | null | undefined;
  readonly activeVaultId: string | null | undefined;
  readonly submit: ReaderNoteRestoreSubmit | null | undefined;
  readonly currentNote?: () => NoteRenderResult | null | undefined;
}): Promise<ReaderDocumentRestoreOutcome> {
  const eligibility = input.note?.restoreEligibility;
  const renderContextId = input.note?.renderContextId;
  if (!input.note || !eligibility?.canRestore || !input.activeVaultId || !renderContextId || !input.submit) {
    return { status: "retained" };
  }
  const request: NoteRestoreArchivedRequest = {
    apiVersion: 1,
    requestId: `noterestorereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
    activeVaultId: input.activeVaultId,
    currentPageId: input.note.summary.pageId,
    renderContextId,
    expectedRevision: eligibility.revision,
  };
  try {
    const result = await input.submit(request);
    if (!restoreIdentityMatches(request, result) ||
      (input.currentNote && !restoreRequestMatchesNote(request, input.currentNote())) ||
      result.status !== "committed" || result.render.summary.pageId !== request.currentPageId ||
      result.render.summary.status !== "active") return { status: "retained" };
    return { status: "committed", render: result.render };
  } catch {
    return { status: "retained" };
  }
}

function archiveRequestMatchesNote(request: NoteArchiveCurrentRequest, note: NoteRenderResult | null | undefined): boolean {
  return note?.summary.pageId === request.currentPageId && note.renderContextId === request.renderContextId &&
    note.archiveEligibility?.revision === request.expectedRevision;
}

function restoreRequestMatchesNote(request: NoteRestoreArchivedRequest, note: NoteRenderResult | null | undefined): boolean {
  return note?.summary.pageId === request.currentPageId && note.renderContextId === request.renderContextId &&
    note.restoreEligibility?.revision === request.expectedRevision;
}

export function readerDocumentArchiveLabels(t: (key: string) => string): ReaderDocumentArchiveLabels {
  return {
    action: t("note.document.archive"), title: t("note.document.archiveTitle"),
    description: t("note.document.archiveDescription"), cancel: t("note.document.archiveCancel"),
    confirm: t("note.document.archiveConfirm"), pending: t("note.document.archiving"),
    failed: t("note.document.archiveFailed")
  };
}

export function readerDocumentRestoreLabels(t: (key: string) => string): ReaderDocumentRestoreLabels {
  return {
    action: t("note.document.restore"), title: t("note.document.restoreTitle"),
    description: t("note.document.restoreDescription"), cancel: t("note.document.restoreCancel"),
    confirm: t("note.document.restoreConfirm"), pending: t("note.document.restoring"),
    failed: t("note.document.restoreFailed"),
  };
}

function archiveIdentityMatches(request: NoteArchiveCurrentRequest, result: NoteArchiveCurrentResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision;
}

function restoreIdentityMatches(request: NoteRestoreArchivedRequest, result: NoteRestoreArchivedResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision;
}

export interface ReaderDocumentActionsProps {
  readonly ownerIdentity: string;
  readonly canMoveToTrash: boolean;
  readonly canMerge: boolean;
  readonly canRelate?: boolean;
  readonly canArchive?: boolean;
  readonly canRestore?: boolean;
  readonly currentTitle: string;
  readonly labels: ReaderDocumentActionLabels;
  readonly mergeLabels: ReaderNoteMergeLabels;
  readonly relateLabels?: ReaderNoteRelateLabels;
  readonly archiveLabels?: ReaderDocumentArchiveLabels;
  readonly restoreLabels?: ReaderDocumentRestoreLabels;
  readonly onMoveToTrash: () => Promise<ReaderDocumentTrashOutcome>;
  readonly onLoadMergeTargets: () => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onMerge: (target: ReaderNoteMergeTarget) => Promise<ReaderNoteMergeOutcome>;
  readonly onLoadRelateTargets?: () => Promise<readonly ReaderNoteMergeTarget[]>;
  readonly onRelate?: (target: ReaderNoteMergeTarget) => Promise<ReaderNoteRelateOutcome>;
  readonly onArchive?: () => Promise<ReaderDocumentArchiveOutcome>;
  readonly onRestore?: () => Promise<ReaderDocumentRestoreOutcome>;
  readonly onCommitted: () => void;
  readonly onMergeCommitted: (render: import("@pige/contracts").NoteRenderResult) => void;
  readonly onRelateCommitted?: (render: import("@pige/contracts").NoteRenderResult) => void;
  readonly onArchiveCommitted?: (render: import("@pige/contracts").NoteRenderResult) => void;
  readonly onRestoreCommitted?: (render: import("@pige/contracts").NoteRenderResult) => void;
}

export function ReaderDocumentActions(props: ReaderDocumentActionsProps): React.JSX.Element | null {
  const canArchive = props.canArchive === true && Boolean(props.archiveLabels && props.onArchive);
  const canRestore = props.canRestore === true && Boolean(props.restoreLabels && props.onRestore);
  const canRelate = props.canRelate === true && Boolean(props.relateLabels && props.onLoadRelateTargets && props.onRelate);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"trash" | "archive" | "restore" | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [relateOpen, setRelateOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const ownerIdentityRef = useRef(props.ownerIdentity);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const archiveActionRef = useRef<HTMLButtonElement>(null);
  const restoreActionRef = useRef<HTMLButtonElement>(null);
  const mergeActionRef = useRef<HTMLButtonElement>(null);
  const relateActionRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  ownerIdentityRef.current = props.ownerIdentity;

  useEffect(() => {
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setMenuOpen(false);
    setConfirmAction(null);
    setMergeOpen(false);
    setRelateOpen(false);
    setPending(false);
    setFailed(false);
  }, [props.ownerIdentity, props.canMoveToTrash, props.canMerge, canArchive, canRestore, canRelate]);

  useEffect(() => {
    if (menuOpen) {
      (props.canMerge
        ? mergeActionRef.current
        : canRelate
          ? relateActionRef.current
        : canArchive
          ? archiveActionRef.current
          : canRestore
            ? restoreActionRef.current
          : actionRef.current)?.focus({ preventScroll: true });
    }
  }, [menuOpen]);

  useEffect(() => {
    if (confirmAction) cancelRef.current?.focus({ preventScroll: true });
  }, [confirmAction]);

  if (!props.canMoveToTrash && !props.canMerge && !canArchive && !canRestore && !canRelate) return null;

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
      const outcome = confirmAction === "archive" && props.onArchive ? await props.onArchive()
        : confirmAction === "restore" && props.onRestore ? await props.onRestore() : await props.onMoveToTrash();
      if (sequence !== requestSequenceRef.current || ownerIdentity !== ownerIdentityRef.current) return;
      if (confirmAction === "archive" && typeof outcome === "object" && outcome.status === "committed") {
        setConfirmAction(null);
        props.onArchiveCommitted?.(outcome.render);
        return;
      }
      if (confirmAction === "restore" && typeof outcome === "object" && outcome.status === "committed") {
        setConfirmAction(null);
        props.onRestoreCommitted?.(outcome.render);
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
        {canRelate && props.relateLabels ? (
          <button
            ref={relateActionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setRelateOpen(true);
            }}
          >
            {props.relateLabels.title}
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
        {canRestore && props.restoreLabels ? (
          <button
            ref={restoreActionRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConfirmAction("restore");
              setFailed(false);
            }}
          >
            {props.restoreLabels.action}
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
    {relateOpen && props.relateLabels && props.onLoadRelateTargets && props.onRelate ? (
      <ReaderNoteRelateDialog
        ownerIdentity={props.ownerIdentity}
        returnFocusRef={triggerRef}
        labels={props.relateLabels}
        onLoadTargets={props.onLoadRelateTargets}
        onRelate={props.onRelate}
        onCancel={() => setRelateOpen(false)}
        onCommitted={(render) => {
          setRelateOpen(false);
          props.onRelateCommitted?.(render);
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
              {confirmAction === "archive" ? props.archiveLabels?.title
                : confirmAction === "restore" ? props.restoreLabels?.title : props.labels.title}
            </h2>
            <p id={`reader-document-${confirmAction}-description`}>
              {confirmAction === "archive" ? props.archiveLabels?.description
                : confirmAction === "restore" ? props.restoreLabels?.description : props.labels.description}
            </p>
          </div>
          {failed ? <p className="error" role="alert">
            {confirmAction === "archive" ? props.archiveLabels?.failed
              : confirmAction === "restore" ? props.restoreLabels?.failed : props.labels.failed}
          </p> : null}
          <div className="confirmation-actions">
            <button ref={cancelRef} type="button" className="secondary" disabled={pending} onClick={cancel}>
              {confirmAction === "archive" ? props.archiveLabels?.cancel
                : confirmAction === "restore" ? props.restoreLabels?.cancel : props.labels.cancel}
            </button>
            <button type="button" className="primary" disabled={pending} onClick={() => void submit()}>
              {pending
                ? confirmAction === "archive" ? props.archiveLabels?.pending
                  : confirmAction === "restore" ? props.restoreLabels?.pending : props.labels.pending
                : confirmAction === "archive" ? props.archiveLabels?.confirm
                  : confirmAction === "restore" ? props.restoreLabels?.confirm : props.labels.confirm}
            </button>
          </div>
        </section>
      </div>
    ) : null}
  </>;
}
