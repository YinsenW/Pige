import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CollectionAddRollupColumnRequest, CollectionSnapshot } from "@pige/schemas";

type Notice = "added" | "stale" | "not_found" | "ineligible" | "failed";
type Draft = { readonly expectedRevisionId: string; readonly label: string; readonly relationColumnId: string;
  readonly aggregation: "count" | "sum"; readonly targetColumnId: string };

export function ManagedCollectionRollupDialog(props: {
  readonly activeVaultId: string; readonly snapshot: CollectionSnapshot; readonly blocked: boolean;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onActiveChange: (active: boolean) => void; readonly onFocusColumn: (columnId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [target, setTarget] = useState<CollectionSnapshot | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(false);
  const sequence = useRef(0); const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerRef = useRef(ownerKey); ownerRef.current = ownerKey;
  const relations = props.snapshot.columns.filter((column) => column.relation?.kind === "pige_single_relation");

  useEffect(() => { sequence.current += 1; setDraft(null); setTarget(null); setNotice(null); setBusy(false); setLoading(false); props.onActiveChange(false); }, [ownerKey]);
  useLayoutEffect(() => { if (draft && !busy && !loading) nameRef.current?.focus(); }, [draft?.relationColumnId, busy, loading]);

  const begin = (): void => {
    if (props.blocked || !props.snapshot.canAddRollupColumn || !relations[0]) return;
    const next = { expectedRevisionId: props.snapshot.revisionId, label: "", relationColumnId: relations[0].columnId,
      aggregation: "count" as const, targetColumnId: "" };
    setDraft(next); setNotice(null); props.onActiveChange(true); void loadTarget(next.relationColumnId, next.expectedRevisionId);
  };
  const chooseRelation = (relationColumnId: string): void => {
    if (!draft || busy || loading || relationColumnId === draft.relationColumnId) return;
    setDraft({ ...draft, relationColumnId, targetColumnId: "" }); setTarget(null); setNotice(null);
    void loadTarget(relationColumnId, draft.expectedRevisionId);
  };
  const cancel = (): void => {
    if (busy) return; sequence.current += 1; setDraft(null); setTarget(null); setNotice(null); setLoading(false);
    props.onActiveChange(false); window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const submit = async (): Promise<void> => {
    if (!draft || props.blocked || busy || loading || !valid(draft, target)) return;
    const request: CollectionAddRollupColumnRequest = {
      apiVersion: 1, requestId: collectionRequestId(), activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId, tableId: props.snapshot.tableId,
      expectedRevisionId: draft.expectedRevisionId, label: draft.label.trim(),
      relationColumnId: draft.relationColumnId, aggregation: draft.aggregation,
      ...(draft.aggregation === "sum" ? { targetColumnId: draft.targetColumnId } : {})
    };
    const run = sequence.current + 1; sequence.current = run; const owner = ownerKey; setBusy(true); setNotice(null);
    try {
      const result = await window.pige.collections.addRollupColumn(request);
      if (sequence.current !== run || ownerRef.current !== owner || result.requestId !== request.requestId ||
          result.activeVaultId !== request.activeVaultId || result.datasetId !== request.datasetId ||
          result.tableId !== request.tableId || result.relationColumnId !== request.relationColumnId ||
          result.aggregation !== request.aggregation || result.targetColumnId !== request.targetColumnId) return;
      if ((result.status === "committed" || result.status === "stale") && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setDraft(null); setTarget(null); setNotice("added"); props.onActiveChange(false); props.onFocusColumn(result.columnId);
      } else {
        if (result.status === "stale") setDraft((current) => current ? { ...current, expectedRevisionId: result.snapshot.revisionId } : current);
        setNotice(result.status);
      }
    } catch { if (sequence.current === run && ownerRef.current === owner) setNotice("failed"); }
    finally { if (sequence.current === run && ownerRef.current === owner) setBusy(false); }
  };

  if (!draft && !props.snapshot.canAddRollupColumn && !notice) return null;
  return <section className="settings-card settings-row tall" aria-label={props.t("collection.rollupBuilder")}>
    {!draft ? props.snapshot.canAddRollupColumn ? <div className="settings-row-control"><button ref={triggerRef} type="button"
      className="settings-button" disabled={props.blocked || busy} onClick={begin}>{props.t("collection.addRollupField")}</button></div> : null
      : <form aria-label={props.t("collection.rollupBuilder")} onSubmit={(event) => { event.preventDefault(); void submit(); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
        <div className="settings-row-copy"><label htmlFor="collection-rollup-name"><strong>{props.t("collection.fieldName")}</strong></label>
          <input ref={nameRef} id="collection-rollup-name" className="settings-input" value={draft.label} maxLength={120}
            disabled={busy} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setNotice(null); }} /></div>
        <div className="settings-row-copy"><label htmlFor="collection-rollup-relation"><strong>{props.t("collection.rollupRelationField")}</strong></label>
          <select id="collection-rollup-relation" className="settings-input" value={draft.relationColumnId} disabled={busy || loading}
            onChange={(event) => chooseRelation(event.target.value)}>{relations.map((column) =>
              <option key={column.columnId} value={column.columnId}>{column.label}</option>)}</select></div>
        <div className="settings-row-copy"><label htmlFor="collection-rollup-aggregation"><strong>{props.t("collection.rollupAggregation")}</strong></label>
          <select id="collection-rollup-aggregation" className="settings-input" value={draft.aggregation} disabled={busy}
            onChange={(event) => { setDraft({ ...draft, aggregation: event.target.value as "count" | "sum" }); setNotice(null); }}>
            <option value="count">{props.t("collection.rollupCount")}</option><option value="sum">{props.t("collection.rollupSum")}</option>
          </select></div>
        {draft.aggregation === "sum" ? <div className="settings-row-copy"><label htmlFor="collection-rollup-target"><strong>{props.t("collection.rollupTargetField")}</strong></label>
          <select id="collection-rollup-target" className="settings-input" value={draft.targetColumnId} disabled={busy || loading || !target}
            onChange={(event) => { setDraft({ ...draft, targetColumnId: event.target.value }); setNotice(null); }}>
            {target?.columns.filter((column) => column.canUseAsRollupTarget).map((column) =>
              <option key={column.columnId} value={column.columnId}>{column.label}</option>)}</select></div> : null}
        {loading ? <p className="muted" role="status">{props.t("collection.rollupLoading")}</p> : null}
        {draft.aggregation === "sum" && target && !target.columns.some((column) => column.canUseAsRollupTarget)
          ? <p className="muted" role="status">{props.t("collection.rollupNoTargetField")}</p> : null}
        <div className="settings-row-control"><button type="submit" className="settings-button primary"
          disabled={busy || loading || props.blocked || !valid(draft, target)}>{props.t(busy ? "collection.saving" : "collection.save")}</button>
          <button type="button" className="settings-button" disabled={busy} onClick={cancel}>{props.t("collection.cancel")}</button></div>
      </form>}
    {notice ? <p className={`settings-inline-status ${notice === "added" ? "success" : "error"}`} role="status">
      {props.t(`collection.rollup_${notice}`)}</p> : null}
  </section>;

  async function loadTarget(relationColumnId: string, expectedRevisionId: string): Promise<void> {
    const relation = props.snapshot.columns.find((column) => column.columnId === relationColumnId)?.relation;
    if (!relation) return;
    const run = sequence.current + 1; sequence.current = run; const owner = ownerKey; setLoading(true); setNotice(null);
    try {
      const result = await window.pige.collections.open({ apiVersion: 1, requestId: collectionRequestId(),
        activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId, tableId: relation.targetTableId, limit: 1 });
      if (sequence.current !== run || ownerRef.current !== owner || props.snapshot.revisionId !== expectedRevisionId ||
          result.status !== "ready" || result.snapshot.revisionId !== expectedRevisionId || result.snapshot.tableId !== relation.targetTableId) {
        if (sequence.current === run && ownerRef.current === owner) setNotice("stale"); return;
      }
      setTarget(result.snapshot); setDraft((current) => {
        if (!current || current.relationColumnId !== relationColumnId) return current;
        const choices = result.snapshot.columns.filter((column) => column.canUseAsRollupTarget);
        return { ...current, targetColumnId: choices.some((column) => column.columnId === current.targetColumnId)
          ? current.targetColumnId : choices[0]?.columnId ?? "" };
      });
    } catch { if (sequence.current === run && ownerRef.current === owner) setNotice("failed"); }
    finally { if (sequence.current === run && ownerRef.current === owner) setLoading(false); }
  }
}

function valid(draft: Draft, target: CollectionSnapshot | null): boolean {
  return draft.label.trim().length > 0 && (draft.aggregation === "count" ||
    !!target?.columns.some((column) => column.columnId === draft.targetColumnId && column.canUseAsRollupTarget));
}
function collectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
