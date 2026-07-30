import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  LibraryRemovePageTagRequest,
  LibraryRemovePageTagResult,
  LibraryTaggedPageSummary,
} from "@pige/contracts";

export interface LibraryPageTagRemoveDialogHandle {
  readonly open: (page: LibraryTaggedPageSummary, trigger: HTMLButtonElement) => void;
}

export interface LibraryPageTagRemoveDialogLabels {
  readonly title: string;
  readonly description: string;
  readonly currentTag: string;
  readonly currentPage: string;
  readonly cancel: string;
  readonly confirm: string;
  readonly pending: string;
  readonly failed: string;
}

export interface LibraryPageTagRemoveDialogProps {
  readonly activeVaultId: string;
  readonly tag: string;
  readonly snapshotId: string;
  readonly removePageTag: (request: LibraryRemovePageTagRequest) => Promise<LibraryRemovePageTagResult>;
  readonly labels: LibraryPageTagRemoveDialogLabels;
  readonly onCommitted: (pageId: string) => Promise<void>;
}

type DialogState = {
  readonly pageId: string;
  readonly pageTitle: string;
  readonly expectedPageUpdatedAt: string;
  readonly state: "ready" | "pending" | "failed";
};

function createRequestId(): `library_page_tag_remove_request_${string}` {
  return `library_page_tag_remove_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export const LibraryPageTagRemoveDialog = forwardRef<
  LibraryPageTagRemoveDialogHandle,
  LibraryPageTagRemoveDialogProps
>(function LibraryPageTagRemoveDialog(props, ref): React.JSX.Element | null {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const activeRequestRef = useRef(false);
  const sequenceRef = useRef(0);
  const activeVaultIdRef = useRef(props.activeVaultId);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    sequenceRef.current += 1;
    activeRequestRef.current = false;
    triggerRef.current = null;
    setDialog(null);
  }, [props.activeVaultId, props.tag, props.snapshotId]);

  useImperativeHandle(ref, () => ({
    open: (page, trigger) => {
      if (activeRequestRef.current) return;
      triggerRef.current = trigger;
      setDialog({ pageId: page.pageId, pageTitle: page.title, expectedPageUpdatedAt: page.updatedAt, state: "ready" });
      window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    },
  }), []);

  const cancel = (): void => {
    if (!dialog || activeRequestRef.current) return;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    setDialog(null);
    window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
  };

  const submit = async (): Promise<void> => {
    if (!dialog || activeRequestRef.current) return;
    activeRequestRef.current = true;
    const sequence = ++sequenceRef.current;
    const request: LibraryRemovePageTagRequest = {
      apiVersion: 1,
      requestId: createRequestId(),
      activeVaultId: props.activeVaultId,
      tag: props.tag,
      pageId: dialog.pageId,
      expectedSnapshotId: props.snapshotId,
      expectedPageUpdatedAt: dialog.expectedPageUpdatedAt,
    };
    setDialog((current) => current ? { ...current, state: "pending" } : current);
    try {
      const result = await props.removePageTag(request);
      if (sequence !== sequenceRef.current || activeVaultIdRef.current !== request.activeVaultId) return;
      if (!identityMatches(request, result)) {
        setDialog((current) => current ? { ...current, state: "failed" } : current);
        window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
        return;
      }
      if (result.status === "committed") {
        triggerRef.current = null;
        setDialog(null);
        await props.onCommitted(request.pageId);
        return;
      }
      setDialog((current) => current ? { ...current, state: "failed" } : current);
      window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
    } catch {
      if (sequence === sequenceRef.current && activeVaultIdRef.current === request.activeVaultId) {
        setDialog((current) => current ? { ...current, state: "failed" } : current);
        window.requestAnimationFrame(() => cancelRef.current?.focus({ preventScroll: true }));
      }
    } finally {
      if (sequence === sequenceRef.current && activeVaultIdRef.current === request.activeVaultId) {
        activeRequestRef.current = false;
      }
    }
  };

  if (!dialog) return null;
  return <div className="confirmation-backdrop">
    <section ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="library-page-tag-remove-title" aria-describedby="library-page-tag-remove-description"
      aria-busy={dialog.state === "pending"} onKeyDown={(event) => {
        if (event.key === "Escape" && dialog.state !== "pending") { event.preventDefault(); cancel(); return; }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (controls.length === 0) return event.preventDefault();
        const first = controls[0]!; const last = controls.at(-1)!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="confirmation-icon" aria-hidden="true">!</div>
      <div className="confirmation-copy">
        <h2 id="library-page-tag-remove-title">{props.labels.title}</h2>
        <p id="library-page-tag-remove-description">{props.labels.description}</p>
        <p><strong>{props.labels.currentTag}</strong> {props.tag}</p>
        <p><strong>{props.labels.currentPage}</strong> {dialog.pageTitle}</p>
        {dialog.state === "failed" ? <p className="error" role="alert">{props.labels.failed}</p> : null}
      </div>
      <div className="confirmation-actions">
        <button ref={cancelRef} type="button" className="secondary" disabled={dialog.state === "pending"} onClick={cancel}>
          {props.labels.cancel}
        </button>
        <button type="button" className="primary danger" disabled={dialog.state === "pending"} onClick={() => void submit()}>
          {dialog.state === "pending" ? props.labels.pending : props.labels.confirm}
        </button>
      </div>
    </section>
  </div>;
});

function identityMatches(request: LibraryRemovePageTagRequest, result: LibraryRemovePageTagResult): boolean {
  return result.apiVersion === request.apiVersion && result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId && result.tag === request.tag && result.pageId === request.pageId &&
    result.expectedSnapshotId === request.expectedSnapshotId && result.expectedPageUpdatedAt === request.expectedPageUpdatedAt;
}
