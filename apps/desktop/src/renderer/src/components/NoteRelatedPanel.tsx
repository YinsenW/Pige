import { useEffect, useRef, useState } from "react";
import type { LibraryRelatedPage, LibraryRelatedResult, NoteRenderResult, NoteUnrelateRequest } from "@pige/contracts";

export type NoteRelatedState = LibraryRelatedResult | "loading" | "unavailable" | null;

export function NoteRelatedPanel(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly related: NoteRelatedState;
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly onCommitted?: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const activeRef = useRef(false);
  const restoreFocusRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const canRemove = Boolean(props.activeVaultId && props.note.renderContextId && props.note.trashEligibility?.revision);

  useEffect(() => {
    const pageId = restoreFocusRef.current;
    if (!pageId) return;
    restoreFocusRef.current = null;
    const trigger = panelRef.current?.querySelector<HTMLButtonElement>(`[data-remove-page-id="${pageId}"]`);
    (trigger ?? panelRef.current)?.focus();
  }, [confirmingId, failedId, pendingId, props.related]);

  const cancel = (pageId: string): void => {
    restoreFocusRef.current = pageId;
    setConfirmingId(null);
  };

  const remove = async (page: LibraryRelatedPage): Promise<void> => {
    if (activeRef.current || !props.activeVaultId || !props.note.renderContextId || !props.note.trashEligibility?.revision) return;
    activeRef.current = true;
    setPendingId(page.summary.pageId); setFailedId(null);
    const request: NoteUnrelateRequest = {
      apiVersion: 1, requestId: `noteunrelatereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId,
      renderContextId: props.note.renderContextId, expectedRevision: props.note.trashEligibility.revision,
      targetPageId: page.summary.pageId, expectedTargetUpdatedAt: page.summary.updatedAt,
    };
    try {
      const result = await window.pige.notes.unrelate(request);
      const matches = result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
        result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
        result.expectedRevision === request.expectedRevision && result.targetPageId === request.targetPageId &&
        result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
      if (matches && result.status === "committed" && result.render.summary.pageId === request.currentPageId) {
        restoreFocusRef.current = page.summary.pageId;
        setConfirmingId(null);
        props.onCommitted?.(result.render);
      } else {
        restoreFocusRef.current = page.summary.pageId;
        setFailedId(page.summary.pageId);
        setConfirmingId(null);
      }
    } catch {
      restoreFocusRef.current = page.summary.pageId;
      setFailedId(page.summary.pageId);
      setConfirmingId(null);
    }
    finally { activeRef.current = false; setPendingId(null); }
  };

  if (props.related === "loading" || props.related === "unavailable") return <aside ref={panelRef} className="note-related" aria-label={props.t("note.related")} tabIndex={-1}><h2>{props.t("note.related")}</h2><p className="related-empty">{props.t(props.related === "loading" ? "note.relatedLoading" : "note.relatedUnavailable")}</p></aside>;
  const outgoing = props.related?.outgoing ?? [], backlinks = props.related?.backlinks ?? [];
  if (!props.related || props.related.totalOutgoing + props.related.totalBacklinks === 0) return <aside ref={panelRef} className="note-related" aria-label={props.t("note.related")} tabIndex={-1}><h2>{props.t("note.related")}</h2><p className="related-empty">{props.t(props.related?.degraded ? "note.relatedUnavailable" : "note.relatedEmpty")}</p></aside>;
  return <aside ref={panelRef} className="note-related" aria-label={props.t("note.related")} tabIndex={-1}><h2>{props.t("note.related")}</h2>
    <RelatedGroup title={props.t("note.outgoingLinks")} pages={outgoing} loadingPageId={props.loadingPageId} onOpen={props.onOpen} t={props.t}
      canRemove={canRemove} confirmingId={confirmingId} pendingId={pendingId} failedId={failedId}
      onConfirm={setConfirmingId} onCancel={cancel} onRemove={remove} />
    <RelatedGroup title={props.t("note.backlinks")} pages={backlinks} loadingPageId={props.loadingPageId} onOpen={props.onOpen} t={props.t} />
  </aside>;
}

function RelatedGroup(props: { readonly title: string; readonly pages: readonly LibraryRelatedPage[]; readonly loadingPageId: string | null; readonly onOpen: (pageId: string) => Promise<void>; readonly t: (key: string) => string; readonly canRemove?: boolean; readonly confirmingId?: string | null; readonly pendingId?: string | null; readonly failedId?: string | null; readonly onConfirm?: (pageId: string | null) => void; readonly onCancel?: (pageId: string) => void; readonly onRemove?: (page: LibraryRelatedPage) => Promise<void> }): React.JSX.Element | null {
  if (props.pages.length === 0) return null;
  return <section className="related-group"><h3>{props.title}</h3><div className="related-list">{props.pages.map((page) => <article className="related-row" key={`${page.relation}:${page.summary.pageId}`}><div><strong>{page.summary.title}</strong><span>{page.target || page.summary.pagePath}</span>{props.failedId === page.summary.pageId ? <span role="alert">{props.t("note.relatedRemoveFailed")}</span> : null}</div><div>
    <button type="button" className="ghost" aria-label={`${props.t("note.open")}: ${page.summary.title}`} disabled={props.loadingPageId === page.summary.pageId || props.pendingId !== null} onClick={() => void props.onOpen(page.summary.pageId)}>{props.loadingPageId === page.summary.pageId ? props.t("note.opening") : props.t("note.open")}</button>
    {props.canRemove && props.onConfirm && props.onRemove ? props.confirmingId === page.summary.pageId ? <><button type="button" className="ghost" disabled={props.pendingId !== null} onClick={() => props.onCancel?.(page.summary.pageId)}>{props.t("note.relatedRemoveCancel")}</button><button type="button" className="ghost" disabled={props.pendingId !== null} onClick={() => void props.onRemove?.(page)}>{props.t(props.pendingId === page.summary.pageId ? "note.relatedRemoving" : "note.relatedRemoveConfirm")}</button></> : <button type="button" className="ghost" data-remove-page-id={page.summary.pageId} disabled={props.pendingId !== null} onClick={() => props.onConfirm?.(page.summary.pageId)}>{props.t("note.relatedRemove")}</button> : null}
  </div></article>)}</div></section>;
}
