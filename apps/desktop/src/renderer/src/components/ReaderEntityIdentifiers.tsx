import { useEffect, useRef, useState } from "react";
import type { NoteChangeEntityIdentifierRequest, NoteChangeEntityIdentifierResult, NoteReadEntityIdentifiersRequest, NoteReadEntityIdentifiersResult, NoteRenderResult } from "@pige/contracts";

export function ReaderEntityIdentifiers(props: { readonly activeVaultId: string; readonly note: NoteRenderResult;
  readonly read: (request: NoteReadEntityIdentifiersRequest) => Promise<NoteReadEntityIdentifiersResult>;
  readonly change: (request: NoteChangeEntityIdentifierRequest) => Promise<NoteChangeEntityIdentifierResult>;
  readonly onCommitted: (render: NoteRenderResult) => void; readonly t: (key: string) => string }): React.JSX.Element | null {
  const context = props.note.renderContextId, revision = props.note.entityType?.revision;
  const owner = `${props.activeVaultId}:${props.note.summary.pageId}:${context ?? ""}:${revision ?? ""}`;
  const ownerRef = useRef(owner), busy = useRef(false), inputRef = useRef<HTMLInputElement>(null);
  const [identifiers, setIdentifiers] = useState<readonly string[]>([]), [draft, setDraft] = useState(""), [state, setState] = useState<"loading" | "ready" | "failed" | "pending">("loading");
  useEffect(() => {
    ownerRef.current = owner; busy.current = false; setDraft(""); setState("loading");
    if (props.note.summary.pageType !== "entity" || !context || !revision) return;
    const request: NoteReadEntityIdentifiersRequest = { apiVersion: 1, requestId: requestId(), activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId, renderContextId: context, expectedRevision: revision };
    void props.read(request).then((result) => { if (ownerRef.current === owner && same(request, result) && result.status === "ready") { setIdentifiers(result.identifiers); setState("ready"); } else if (ownerRef.current === owner) setState("failed"); }).catch(() => { if (ownerRef.current === owner) setState("failed"); });
  }, [owner]);
  if (props.note.summary.pageType !== "entity" || !context || !revision) return null;
  const change = async (action: "add" | "remove", identifier: string): Promise<void> => {
    if (busy.current || !identifier) return; busy.current = true; const requestOwner = owner; setState("pending");
    const request: NoteChangeEntityIdentifierRequest = { apiVersion: 1, requestId: requestId(), activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId, renderContextId: context, expectedRevision: revision, action, identifier };
    try { const result = await props.change(request); if (ownerRef.current !== requestOwner || !same(request, result) || result.status !== "committed") { if (ownerRef.current === requestOwner) setState("failed"); return; } props.onCommitted(result.render); }
    catch { if (ownerRef.current === requestOwner) setState("failed"); }
    finally { if (ownerRef.current === requestOwner) { busy.current = false; setState("ready"); window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })); } }
  };
  return <section className="reader-entity-mentions" aria-label={props.t("note.entityIdentifiers.title")}><strong>{props.t("note.entityIdentifiers.title")}</strong>
    {identifiers.map((identifier) => <span key={identifier}>{identifier}<button type="button" disabled={state === "pending"} onClick={() => void change("remove", identifier)}>{props.t("note.entityIdentifiers.remove")}</button></span>)}
    <span><input ref={inputRef} value={draft} maxLength={256} placeholder={props.t("note.entityIdentifiers.placeholder")} onChange={(event) => setDraft(event.currentTarget.value.normalize("NFKC").replace(/\s+/gu, " ").trim())} />
      <button type="button" disabled={state !== "ready" || !draft || identifiers.includes(draft)} onClick={() => void change("add", draft)}>{props.t("note.entityIdentifiers.add")}</button></span>
    {state === "loading" || state === "pending" ? <span role="status">{props.t("note.entityIdentifiers.saving")}</span> : null}{state === "failed" ? <span role="alert">{props.t("note.entityIdentifiers.failed")}</span> : null}
  </section>;
}
function requestId(): string { return `entityidentifierreq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`; }
function same(request: { readonly requestId: string; readonly activeVaultId: string; readonly currentPageId: string; readonly renderContextId: string; readonly expectedRevision: string }, result: { readonly requestId: string; readonly activeVaultId: string; readonly currentPageId: string; readonly renderContextId: string; readonly expectedRevision: string }): boolean { return request.requestId === result.requestId && request.activeVaultId === result.activeVaultId && request.currentPageId === result.currentPageId && request.renderContextId === result.renderContextId && request.expectedRevision === result.expectedRevision; }
