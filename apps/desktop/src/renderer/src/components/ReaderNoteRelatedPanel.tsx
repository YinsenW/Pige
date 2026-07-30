import { useEffect, useRef, useState } from "react";
import type {
  LibraryRelatedPage,
  LibraryRelatedResult,
  NoteRenderResult,
  NoteUnlinkRelationRequest,
  NoteUnlinkRelationResult,
} from "@pige/contracts";

export type NoteRelatedState = LibraryRelatedResult | "loading" | "unavailable" | null;

export function ReaderNoteRelatedPanel(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly related: NoteRelatedState;
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly onUnlink?: (request: NoteUnlinkRelationRequest) => Promise<NoteUnlinkRelationResult>;
  readonly onCommitted?: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const ownerIdentity = `${props.note.summary.pageId}:${props.note.renderContextId ?? "none"}:${props.note.trashEligibility?.revision ?? "none"}`;
  const ownerRef = useRef(ownerIdentity);
  const inFlightRef = useRef(false);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [confirmTarget, setConfirmTarget] = useState<LibraryRelatedPage | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  ownerRef.current = ownerIdentity;
  useEffect(() => {
    inFlightRef.current = false;
    setConfirmTarget(null);
    setPending(false);
    setFailed(false);
  }, [ownerIdentity]);

  const restoreFocus = (pageId: string): void => {
    window.requestAnimationFrame(() => triggerRefs.current.get(pageId)?.focus({ preventScroll: true }));
  };
  const unlink = async (): Promise<void> => {
    const target = confirmTarget;
    const renderContextId = props.note.renderContextId;
    const expectedRevision = props.note.trashEligibility?.revision;
    if (!target || !props.activeVaultId || !renderContextId || !expectedRevision || !props.onUnlink || inFlightRef.current) return;
    const request: NoteUnlinkRelationRequest = {
      apiVersion: 1,
      requestId: `noteunlinkreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId,
      renderContextId,
      expectedRevision,
      targetPageId: target.summary.pageId,
      expectedTargetUpdatedAt: target.summary.updatedAt,
    };
    const identity = ownerIdentity;
    inFlightRef.current = true;
    setPending(true);
    setFailed(false);
    try {
      const result = await props.onUnlink(request);
      if (ownerRef.current !== identity || !sameIdentity(request, result)) return;
      if (result.status === "committed" && result.render.summary.pageId === request.currentPageId &&
          result.render.summary.pageType === "note" && result.render.summary.status === "active") {
        setConfirmTarget(null);
        props.onCommitted?.(result.render);
        return;
      }
      setFailed(true);
      restoreFocus(target.summary.pageId);
    } catch {
      if (ownerRef.current === identity) {
        setFailed(true);
        restoreFocus(target.summary.pageId);
      }
    } finally {
      if (ownerRef.current === identity) {
        inFlightRef.current = false;
        setPending(false);
      }
    }
  };

  if (props.related === "loading" || props.related === "unavailable") {
    return <aside className="note-related" aria-label={props.t("note.related")}><h2>{props.t("note.related")}</h2><p className="related-empty">
      {props.related === "loading" ? props.t("note.relatedLoading") : props.t("note.relatedUnavailable")}
    </p></aside>;
  }
  const outgoing = props.related?.outgoing ?? [];
  const backlinks = props.related?.backlinks ?? [];
  const total = (props.related?.totalOutgoing ?? 0) + (props.related?.totalBacklinks ?? 0);
  if (!props.related || total === 0) {
    return <aside className="note-related" aria-label={props.t("note.related")}><h2>{props.t("note.related")}</h2><p className="related-empty">
      {props.related?.degraded ? props.t("note.relatedUnavailable") : props.t("note.relatedEmpty")}
    </p></aside>;
  }
  return <aside className="note-related" aria-label={props.t("note.related")}>
    <h2>{props.t("note.related")}</h2>
    <RelatedGroup title={props.t("note.outgoingLinks")} pages={outgoing} loadingPageId={props.loadingPageId}
      onOpen={props.onOpen} {...(props.onUnlink ? { onUnlink: (page: LibraryRelatedPage) => { setConfirmTarget(page); setFailed(false); } } : {})}
      triggerRefs={triggerRefs.current} t={props.t} />
    <RelatedGroup title={props.t("note.backlinks")} pages={backlinks} loadingPageId={props.loadingPageId}
      onOpen={props.onOpen} triggerRefs={triggerRefs.current} t={props.t} />
    {confirmTarget ? <div className="confirmation-backdrop"><section className="confirmation-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="note-unlink-title" aria-describedby="note-unlink-description" aria-busy={pending}>
      <div className="confirmation-copy"><h2 id="note-unlink-title">{props.t("note.unlink.title")}</h2>
        <p id="note-unlink-description">{props.t("note.unlink.description")}</p>
        {failed ? <p role="alert">{props.t("note.unlink.failed")}</p> : null}</div>
      <div className="confirmation-actions"><button type="button" disabled={pending} autoFocus onClick={() => {
        const pageId = confirmTarget.summary.pageId; setConfirmTarget(null); setFailed(false); restoreFocus(pageId);
      }}>{props.t("note.unlink.cancel")}</button><button type="button" className="danger" disabled={pending} onClick={() => void unlink()}>
        {props.t(pending ? "note.unlink.pending" : "note.unlink.confirm")}</button></div>
    </section></div> : null}
  </aside>;
}

function RelatedGroup(props: {
  readonly title: string;
  readonly pages: readonly LibraryRelatedPage[];
  readonly loadingPageId: string | null;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly onUnlink?: (page: LibraryRelatedPage) => void;
  readonly triggerRefs: Map<string, HTMLButtonElement>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.pages.length === 0) return null;
  return <section className="related-group"><h3>{props.title}</h3><div className="related-list">{props.pages.map((page) =>
    <article className="related-row" key={`${page.relation}:${page.summary.pageId}`}><div><strong>{page.summary.title}</strong>
      <span>{page.target || page.summary.pagePath}</span></div><div className="settings-inline-actions">
      <button type="button" className="ghost" aria-label={`${props.t("note.open")}: ${page.summary.title}`}
        disabled={props.loadingPageId === page.summary.pageId} onClick={() => void props.onOpen(page.summary.pageId)}>
        {props.loadingPageId === page.summary.pageId ? props.t("note.opening") : props.t("note.open")}</button>
      {props.onUnlink ? <button ref={(node) => { if (node) props.triggerRefs.set(page.summary.pageId, node); else props.triggerRefs.delete(page.summary.pageId); }}
        type="button" className="ghost" onClick={() => props.onUnlink?.(page)}>{props.t("note.unlink.action")}</button> : null}
    </div></article>)}</div></section>;
}

function sameIdentity(request: NoteUnlinkRelationRequest, result: NoteUnlinkRelationResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.targetPageId === request.targetPageId &&
    result.expectedTargetUpdatedAt === request.expectedTargetUpdatedAt;
}
