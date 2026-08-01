import { useEffect, useRef, useState } from "react";
import type { NoteEntityType, NoteRenderResult, NoteSetEntityTypeRequest, NoteSetEntityTypeResult } from "@pige/contracts";

const entityTypes: readonly NoteEntityType[] = [
  "person", "organization", "product", "place", "project", "event", "other"
];

export function ReaderEntityTypeControl(props: {
  readonly activeVaultId: string;
  readonly note: NoteRenderResult;
  readonly onSetType: (request: NoteSetEntityTypeRequest) => Promise<NoteSetEntityTypeResult>;
  readonly onCommitted: (render: NoteRenderResult) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const summary = props.note.entityType, renderContextId = props.note.renderContextId;
  const ownerIdentity = `${props.activeVaultId}:${props.note.summary.pageId}:${renderContextId ?? ""}:${summary?.revision ?? ""}`;
  const [draft, setDraft] = useState<NoteEntityType | null>(summary?.entityType ?? null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Exclude<NoteSetEntityTypeResult["status"], "committed"> | null>(null);
  const ownerRef = useRef(ownerIdentity), activeRef = useRef(false), restoreFocusRef = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    ownerRef.current = ownerIdentity; activeRef.current = false; setDraft(summary?.entityType ?? null);
    setPending(false); setNotice(null);
  }, [ownerIdentity, summary?.entityType]);
  useEffect(() => {
    if (pending || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => selectRef.current?.focus({ preventScroll: true })));
  }, [pending]);
  if (props.note.summary.pageType !== "entity" || !summary || !renderContextId || !draft) return null;

  const setType = async (entityType: NoteEntityType): Promise<void> => {
    if (!summary.canChange || activeRef.current || entityType === summary.entityType) { setDraft(summary.entityType); return; }
    activeRef.current = true; const requestOwner = ownerIdentity;
    const request: NoteSetEntityTypeRequest = { apiVersion: 1,
      requestId: `noteentitytypereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId, currentPageId: props.note.summary.pageId, renderContextId,
      expectedRevision: summary.revision, entityType };
    setDraft(entityType); setPending(true); setNotice(null);
    try {
      const result = await props.onSetType(request);
      if (ownerRef.current !== requestOwner || !sameIdentity(request, result)) return;
      if (result.status !== "committed") { setNotice(result.status); return; }
      if (result.render.summary.pageId !== request.currentPageId || result.render.summary.pageType !== "entity" ||
        result.render.entityType?.entityType !== entityType || result.render.entityType.canChange !== true) {
        setNotice("failed"); return;
      }
      props.onCommitted(result.render);
    } catch { if (ownerRef.current === requestOwner) setNotice("failed"); }
    finally {
      if (ownerRef.current === requestOwner) { activeRef.current = false; restoreFocusRef.current = true; setPending(false); }
    }
  };

  return <span className="reader-entity-type">
    <label htmlFor="reader-entity-type">{props.t("note.entityType.label")}</label>
    <select id="reader-entity-type" ref={selectRef} value={draft} disabled={!summary.canChange || pending}
      aria-busy={pending || undefined} onChange={(event) => void setType(event.currentTarget.value as NoteEntityType)}>
      {entityTypes.map((value) => <option key={value} value={value}>{props.t(`note.entityType.value.${value}`)}</option>)}
    </select>
    {pending ? <span role="status">{props.t("note.entityType.saving")}</span> : null}
    {notice ? <span role={notice === "failed" ? "alert" : "status"} aria-live="polite">
      {props.t(`note.entityType.notice.${notice}`)}
    </span> : null}
  </span>;
}

function sameIdentity(request: NoteSetEntityTypeRequest, result: NoteSetEntityTypeResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.currentPageId === request.currentPageId && result.renderContextId === request.renderContextId &&
    result.expectedRevision === request.expectedRevision && result.entityType === request.entityType;
}
