import { useEffect, useRef, useState } from "react";
import type { NoteRenderResult, NoteSourceDerivedPageSummary } from "@pige/contracts";

type DerivedState = "loading" | "unavailable" | readonly NoteSourceDerivedPageSummary[];

export function SourceDerivedNotesPanel(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly sourceId: string;
  readonly onOpen: (pageId: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const renderContextId = props.note.renderContextId;
  const ownerIdentity = `${props.activeVaultId ?? "none"}:${props.note.summary.pageId}:${renderContextId ?? "none"}:${props.sourceId}`;
  const ownerRef = useRef(ownerIdentity);
  const [state, setState] = useState<DerivedState>("loading");
  const [opening, setOpening] = useState<string | null>(null);
  ownerRef.current = ownerIdentity;

  useEffect(() => {
    if (!props.activeVaultId || !renderContextId) {
      setState("unavailable");
      return;
    }
    let disposed = false;
    setState("loading");
    const request = {
      apiVersion: 1 as const,
      requestId: `notesourcederived_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      currentPageId: props.note.summary.pageId,
      renderContextId,
      sourceId: props.sourceId
    };
    void window.pige.notes.listSourceDerived(request).then((result) => {
      if (disposed || ownerRef.current !== ownerIdentity || result.requestId !== request.requestId) return;
      setState(result.status === "ready" && result.sourceId === request.sourceId ? result.pages : "unavailable");
    }).catch(() => {
      if (!disposed && ownerRef.current === ownerIdentity) setState("unavailable");
    });
    return () => { disposed = true; };
  }, [ownerIdentity, props.activeVaultId, props.note.summary.pageId, props.sourceId, renderContextId]);

  if (state === "loading" || state === "unavailable") {
    return <aside className="note-related" aria-label={props.t("note.backlinks")}><h2>{props.t("note.backlinks")}</h2><p className="related-empty">
      {props.t(state === "loading" ? "note.relatedLoading" : "note.relatedUnavailable")}
    </p></aside>;
  }
  if (state.length === 0) return <aside className="note-related" aria-label={props.t("note.backlinks")}><h2>{props.t("note.backlinks")}</h2><p className="related-empty">
    {props.t("note.relatedEmpty")}
  </p></aside>;
  return <aside className="note-related" aria-label={props.t("note.backlinks")}>
    <h2>{props.t("note.backlinks")}</h2>
    <div className="related-list">{state.map((page) => <article className="related-row" key={page.pageId}><div>
      <strong>{page.title}</strong><span>{props.t(`library.type.${page.pageType}`)}</span>
    </div><div className="settings-inline-actions"><button type="button" className="ghost" disabled={opening === page.pageId}
      aria-label={`${props.t("note.open")}: ${page.title}`} onClick={() => {
        if (opening) return;
        setOpening(page.pageId);
        void props.onOpen(page.pageId).catch(() => undefined).finally(() => {
          if (ownerRef.current === ownerIdentity) setOpening(null);
        });
      }}>{opening === page.pageId ? props.t("note.opening") : props.t("note.open")}</button></div>
    </article>)}</div>
  </aside>;
}
