import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CollectionAddLookupColumnRequest, CollectionSnapshot, CollectionUpdateLookupColumnRequest } from "@pige/schemas";

type LookupNotice = "added" | "updated" | "stale" | "not_found" | "ineligible" | "failed";
type LookupDraft = {
  readonly columnId?: string;
  readonly expectedRevisionId: string;
  readonly label: string;
  readonly relationColumnId: string;
  readonly targetColumnId: string;
  readonly originalRelationColumnId?: string;
  readonly originalTargetColumnId?: string;
};

export function ManagedCollectionLookupDialog(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly onFocusColumn: (columnId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<LookupDraft | null>(null);
  const [targetSnapshot, setTargetSnapshot] = useState<CollectionSnapshot | null>(null);
  const [notice, setNotice] = useState<LookupNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const relationRef = useRef<HTMLSelectElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;

  useEffect(() => {
    sequence.current += 1;
    setDraft(null);
    setTargetSnapshot(null);
    setNotice(null);
    setBusy(false);
    setLoading(false);
    props.onActiveChange(false);
  }, [ownerKey]);

  useLayoutEffect(() => {
    if (draft && !busy && !loading) (draft.columnId ? relationRef.current : nameRef.current)?.focus();
  }, [draft?.columnId, draft?.relationColumnId, busy, loading]);

  const relations = props.snapshot.columns.filter((column) => column.relation?.kind === "pige_single_relation");
  const begin = (): void => {
    if (props.blocked || !props.snapshot.canAddLookupColumn || relations.length === 0) return;
    const relation = relations[0]!;
    const next = {
      expectedRevisionId: props.snapshot.revisionId,
      label: "",
      relationColumnId: relation.columnId,
      targetColumnId: ""
    };
    setDraft(next);
    setNotice(null);
    props.onActiveChange(true);
    void loadTarget(relation.columnId, next.expectedRevisionId);
  };

  const beginEdit = (columnId: string): void => {
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === columnId);
    if (props.blocked || !column?.canEditLookup || !column.lookup) return;
    const next: LookupDraft = {
      columnId,
      expectedRevisionId: props.snapshot.revisionId,
      label: column.label,
      relationColumnId: column.lookup.relationColumnId,
      targetColumnId: column.lookup.targetColumnId,
      originalRelationColumnId: column.lookup.relationColumnId,
      originalTargetColumnId: column.lookup.targetColumnId
    };
    setDraft(next);
    setNotice(null);
    props.onActiveChange(true);
    void loadTarget(next.relationColumnId, next.expectedRevisionId);
  };

  const chooseRelation = (relationColumnId: string): void => {
    if (!draft || busy || loading || relationColumnId === draft.relationColumnId) return;
    setDraft({ ...draft, relationColumnId, targetColumnId: "" });
    setTargetSnapshot(null);
    setNotice(null);
    void loadTarget(relationColumnId, draft.expectedRevisionId);
  };

  const cancel = (): void => {
    if (busy) return;
    sequence.current += 1;
    setDraft(null);
    setTargetSnapshot(null);
    setNotice(null);
    setLoading(false);
    props.onActiveChange(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submit = async (): Promise<void> => {
    if (!draft || props.blocked || busy || loading || !isValid(draft, targetSnapshot)) return;
    const base = {
      apiVersion: 1 as const,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: draft.expectedRevisionId,
      relationColumnId: draft.relationColumnId,
      targetColumnId: draft.targetColumnId
    };
    const request: CollectionAddLookupColumnRequest | CollectionUpdateLookupColumnRequest = draft.columnId
      ? { ...base, columnId: draft.columnId }
      : { ...base, label: draft.label.trim() };
    const requestSequence = sequence.current + 1;
    sequence.current = requestSequence;
    const expectedOwner = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = "columnId" in request
        ? await window.pige.collections.updateLookupColumn(request)
        : await window.pige.collections.addLookupColumn(request);
      if (sequence.current !== requestSequence || ownerRef.current !== expectedOwner ||
          result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId ||
          result.datasetId !== request.datasetId || result.tableId !== request.tableId ||
          result.relationColumnId !== request.relationColumnId || result.targetColumnId !== request.targetColumnId) return;
      if ((result.status === "committed" || result.status === "stale") &&
          !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setDraft(null);
        setTargetSnapshot(null);
        setNotice("columnId" in request ? "updated" : "added");
        props.onActiveChange(false);
        props.onFocusColumn(result.columnId);
      } else {
        if (result.status === "stale") {
          setDraft((current) => current ? { ...current, expectedRevisionId: result.snapshot.revisionId } : current);
        }
        setNotice(result.status);
      }
    } catch {
      if (sequence.current === requestSequence && ownerRef.current === expectedOwner) setNotice("failed");
    } finally {
      if (sequence.current === requestSequence && ownerRef.current === expectedOwner) setBusy(false);
    }
  };

  const editable = props.snapshot.columns.filter((column) => column.canEditLookup);
  if (!draft && !props.snapshot.canAddLookupColumn && editable.length === 0 && !notice) return null;
  return <section className="settings-card settings-row tall" aria-label={props.t("collection.lookupBuilder")}>
    {!draft ? <div className="settings-row-control">
      {props.snapshot.canAddLookupColumn ? <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy} onClick={begin}>
        {props.t("collection.addLookupField")}
      </button> : null}
      {editable.map((column) => <button key={column.columnId} type="button" className="settings-button"
        disabled={props.blocked || busy} onClick={() => beginEdit(column.columnId)}>{props.t("collection.editLookupField")}: {column.label}</button>)}
    </div> : <form aria-label={props.t("collection.lookupBuilder")} onSubmit={(event) => { event.preventDefault(); void submit(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } }}>
      {!draft.columnId ? <div className="settings-row-copy">
        <label htmlFor="collection-lookup-name"><strong>{props.t("collection.fieldName")}</strong></label>
        <input ref={nameRef} id="collection-lookup-name" className="settings-input" value={draft.label}
          maxLength={120} disabled={busy} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setNotice(null); }} />
      </div> : null}
      <div className="settings-row-copy">
        <label htmlFor="collection-lookup-relation"><strong>{props.t("collection.lookupRelationField")}</strong></label>
        <select ref={relationRef} id="collection-lookup-relation" className="settings-input" value={draft.relationColumnId}
          disabled={busy || loading} onChange={(event) => chooseRelation(event.target.value)}>
          {relations.map((column) => <option key={column.columnId} value={column.columnId}>{column.label}</option>)}
        </select>
      </div>
      <div className="settings-row-copy">
        <label htmlFor="collection-lookup-target"><strong>{props.t("collection.lookupTargetField")}</strong></label>
        <select id="collection-lookup-target" className="settings-input" value={draft.targetColumnId}
          disabled={busy || loading || !targetSnapshot}
          onChange={(event) => { setDraft({ ...draft, targetColumnId: event.target.value }); setNotice(null); }}>
          {targetSnapshot?.columns.filter((column) => column.canUseAsLookupTarget)
            .map((column) => <option key={column.columnId} value={column.columnId}>{column.label}</option>)}
        </select>
      </div>
      {loading ? <p className="muted" role="status">{props.t("collection.lookupLoading")}</p> : null}
      {targetSnapshot && !targetSnapshot.columns.some((column) => column.canUseAsLookupTarget)
        ? <p className="muted" role="status">{props.t("collection.lookupNoTargetField")}</p> : null}
      <div className="settings-row-control">
        <button type="submit" className="settings-button primary"
          disabled={busy || loading || props.blocked || !isValid(draft, targetSnapshot)}>
          {props.t(busy ? "collection.saving" : "collection.save")}
        </button>
        <button type="button" className="settings-button" disabled={busy} onClick={cancel}>{props.t("collection.cancel")}</button>
      </div>
    </form>}
    {notice ? <p className={`settings-inline-status ${notice === "added" || notice === "updated" ? "success" : "error"}`} role="status">
      {props.t(`collection.lookup_${notice}`)}
    </p> : null}
  </section>;

  async function loadTarget(relationColumnId: string, expectedRevisionId: string): Promise<void> {
    const relation = props.snapshot.columns.find((column) => column.columnId === relationColumnId)?.relation;
    if (!relation) return;
    const requestSequence = sequence.current + 1;
    sequence.current = requestSequence;
    const expectedOwner = ownerKey;
    setLoading(true);
    setNotice(null);
    try {
      const result = await window.pige.collections.open({
        apiVersion: 1, requestId: createCollectionRequestId(), activeVaultId: props.activeVaultId,
        datasetId: props.snapshot.datasetId, tableId: relation.targetTableId, limit: 1
      });
      if (sequence.current !== requestSequence || ownerRef.current !== expectedOwner ||
          props.snapshot.revisionId !== expectedRevisionId || result.status !== "ready" ||
          result.snapshot.revisionId !== expectedRevisionId || result.snapshot.tableId !== relation.targetTableId) {
        if (sequence.current === requestSequence && ownerRef.current === expectedOwner) setNotice("stale");
        return;
      }
      setTargetSnapshot(result.snapshot);
      setDraft((current) => {
        if (!current || current.relationColumnId !== relationColumnId) return current;
        const targets = result.snapshot.columns.filter((column) => column.canUseAsLookupTarget);
        return { ...current, targetColumnId: targets.some((column) => column.columnId === current.targetColumnId)
          ? current.targetColumnId : targets[0]?.columnId ?? "" };
      });
    } catch {
      if (sequence.current === requestSequence && ownerRef.current === expectedOwner) setNotice("failed");
    } finally {
      if (sequence.current === requestSequence && ownerRef.current === expectedOwner) setLoading(false);
    }
  }
}

function isValid(draft: LookupDraft, target: CollectionSnapshot | null): boolean {
  const changed = !draft.columnId || draft.relationColumnId !== draft.originalRelationColumnId ||
    draft.targetColumnId !== draft.originalTargetColumnId;
  return (draft.columnId !== undefined || draft.label.trim().length > 0) && changed && !!target?.columns.some((column) =>
    column.columnId === draft.targetColumnId && column.canUseAsLookupTarget);
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
