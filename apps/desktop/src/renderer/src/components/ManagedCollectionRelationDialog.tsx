import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionAddRelationColumnRequest,
  CollectionEditRelationCellRequest,
  CollectionOpenRequest,
  CollectionOpenResult,
  CollectionSnapshot
} from "@pige/schemas";
import { formatCollectionCellValue } from "./ManagedCollectionScalarCellEditor";

type RelationDraft =
  | {
      readonly mode: "add";
      readonly expectedRevisionId: string;
      readonly label: string;
      readonly targetTableId: string;
      readonly targetDisplayColumnId: string;
    }
  | {
      readonly mode: "edit";
      readonly expectedRevisionId: string;
      readonly rowId: string;
      readonly columnId: string;
      readonly originalTargetRowId: string | null;
      readonly targetRowId: string | null;
    };

type TargetTable = { readonly tableId: string; readonly tableName: string };
type RelationNotice = "added" | "saved" | "stale" | "not_found" | "ineligible" | "failed";

export function ManagedCollectionRelationDialog(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly requestedEdit: {
    readonly rowId: string;
    readonly columnId: string;
    readonly ownerKey: string;
    readonly revisionId: string;
  } | null;
  readonly onEditRequestHandled: () => void;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly onFocusCell: (rowId: string, columnId: string) => void;
  readonly onFocusColumn: (columnId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<RelationDraft | null>(null);
  const [notice, setNotice] = useState<RelationNotice | null>(null);
  const [noticeMode, setNoticeMode] = useState<RelationDraft["mode"]>("add");
  const [busy, setBusy] = useState(false);
  const [targetTables, setTargetTables] = useState<readonly TargetTable[]>([]);
  const [targetSnapshot, setTargetSnapshot] = useState<CollectionSnapshot | null>(null);
  const [targetRows, setTargetRows] = useState<CollectionSnapshot["rows"]>([]);
  const [nextRowCursor, setNextRowCursor] = useState<string | undefined>();
  const [browsing, setBrowsing] = useState(false);
  const [browseFailed, setBrowseFailed] = useState(false);
  const requestSequence = useRef(0);
  const browseSequence = useRef(0);
  const activeRequestRef = useRef<number | null>(null);
  const browseActiveRef = useRef(false);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerKeyRef = useRef(ownerKey);
  const revisionRef = useRef(props.snapshot.revisionId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const targetListRef = useRef<HTMLDivElement | null>(null);
  const pendingTriggerFocusRef = useRef(false);
  const pendingDraftFocusRef = useRef(false);
  ownerKeyRef.current = ownerKey;
  revisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    browseSequence.current += 1;
    activeRequestRef.current = null;
    browseActiveRef.current = false;
    pendingTriggerFocusRef.current = false;
    pendingDraftFocusRef.current = false;
    setDraft(null);
    setNotice(null);
    setNoticeMode("add");
    setBusy(false);
    setTargetTables([]);
    setTargetSnapshot(null);
    setTargetRows([]);
    setNextRowCursor(undefined);
    setBrowsing(false);
    setBrowseFailed(false);
    props.onActiveChange(false);
  }, [ownerKey]);

  useLayoutEffect(() => {
    if (busy || browsing) return;
    if (pendingDraftFocusRef.current && draft) {
      pendingDraftFocusRef.current = false;
      (draft.mode === "add" ? nameRef.current : targetListRef.current)?.focus();
      return;
    }
    if (!pendingTriggerFocusRef.current || draft) return;
    pendingTriggerFocusRef.current = false;
    triggerRef.current?.focus();
  }, [browsing, busy, draft, notice, props.snapshot.revisionId]);

  const beginAdd = (): void => {
    if (props.blocked || activeRequestRef.current !== null || !props.snapshot.canAddRelationColumn) return;
    const displayColumn = props.snapshot.columns.find((column) => column.canUseAsRelationDisplay);
    setDraft({
      mode: "add",
      expectedRevisionId: props.snapshot.revisionId,
      label: "",
      targetTableId: props.snapshot.tableId,
      targetDisplayColumnId: displayColumn?.columnId ?? ""
    });
    setNotice(null);
    setNoticeMode("add");
    setTargetTables([{ tableId: props.snapshot.tableId, tableName: props.snapshot.tableName }]);
    adoptTargetSnapshot(props.snapshot, undefined, true);
    props.onActiveChange(true);
    pendingDraftFocusRef.current = true;
    void loadCurrentDatasetTables();
  };

  const beginEdit = (rowId: string, columnId: string): void => {
    if (props.blocked || activeRequestRef.current !== null) return;
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === columnId);
    const row = props.snapshot.rows.find((candidate) => candidate.rowId === rowId);
    const value = row?.cells.find((cell) => cell.columnId === columnId)?.value;
    if (!column?.canEditRelation || !column.relation || typeof value !== "object" || value === null || value.kind !== "relation") return;
    setDraft({
      mode: "edit",
      expectedRevisionId: props.snapshot.revisionId,
      rowId,
      columnId,
      originalTargetRowId: value.targetRowId,
      targetRowId: value.targetRowId
    });
    setNotice(null);
    setNoticeMode("edit");
    setTargetTables([]);
    setTargetSnapshot(null);
    setTargetRows([]);
    setNextRowCursor(undefined);
    props.onActiveChange(true);
    pendingDraftFocusRef.current = true;
    void loadTargetPage(column.relation.targetTableId, undefined, true);
  };

  useEffect(() => {
    const request = props.requestedEdit;
    if (!request) return;
    props.onEditRequestHandled();
    if (request.ownerKey !== ownerKey || request.revisionId !== props.snapshot.revisionId) return;
    beginEdit(request.rowId, request.columnId);
  }, [props.requestedEdit]);

  const cancelDraft = (): void => {
    if (busy) return;
    const current = draft;
    browseSequence.current += 1;
    browseActiveRef.current = false;
    setDraft(null);
    setNotice(null);
    setTargetTables([]);
    setTargetSnapshot(null);
    setTargetRows([]);
    setNextRowCursor(undefined);
    setBrowsing(false);
    setBrowseFailed(false);
    props.onActiveChange(false);
    if (current?.mode === "edit") props.onFocusCell(current.rowId, current.columnId);
    else pendingTriggerFocusRef.current = true;
  };

  const chooseTargetTable = (targetTableId: string): void => {
    if (!draft || draft.mode !== "add" || browsing || busy || targetTableId === draft.targetTableId) return;
    setDraft({ ...draft, targetTableId, targetDisplayColumnId: "" });
    setTargetSnapshot(null);
    setTargetRows([]);
    setNextRowCursor(undefined);
    setBrowseFailed(false);
    if (targetTableId === props.snapshot.tableId) {
      adoptTargetSnapshot(props.snapshot, undefined, true);
      return;
    }
    void loadTargetPage(targetTableId, undefined, true);
  };

  const submit = async (): Promise<void> => {
    if (!draft || props.blocked || activeRequestRef.current !== null) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequestRef.current = sequence;
    const identity = {
      apiVersion: 1 as const,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: draft.expectedRevisionId
    };
    const request: CollectionAddRelationColumnRequest | CollectionEditRelationCellRequest = draft.mode === "add"
      ? {
          ...identity,
          label: draft.label.trim(),
          targetTableId: draft.targetTableId,
          targetDisplayColumnId: draft.targetDisplayColumnId
        }
      : {
          ...identity,
          rowId: draft.rowId,
          columnId: draft.columnId,
          targetRowId: draft.targetRowId
        };
    if (("label" in request &&
          (!props.snapshot.canAddRelationColumn || !request.label || !request.targetDisplayColumnId)) ||
        (!("label" in request) &&
          (!relationEditStillEligible(request) || draft.mode !== "edit" || draft.targetRowId === draft.originalTargetRowId))) {
      activeRequestRef.current = null;
      return;
    }
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = "label" in request
        ? await window.pige.collections.addRelationColumn(request)
        : await window.pige.collections.editRelationCell(request);
      if (!isCurrent(sequence, expectedOwnerKey, request.expectedRevisionId) || !identityMatches(request, result)) return;
      if ((result.status === "committed" || result.status === "stale") &&
          !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setDraft(null);
        setNotice("label" in request ? "added" : "saved");
        props.onActiveChange(false);
        if ("label" in request && "columnId" in result && !("rowId" in result)) props.onFocusColumn(result.columnId);
        else if ("rowId" in result) props.onFocusCell(result.rowId, result.columnId);
        return;
      }
      if (result.status === "stale") {
        setDraft((current) => current ? {
          ...current,
          expectedRevisionId: result.snapshot.revisionId,
          ...(current.mode === "edit" ? {
            originalTargetRowId: relationTargetInSnapshot(result.snapshot, current.rowId, current.columnId)
          } : {})
        } : current);
      }
      setNotice(result.status);
      pendingDraftFocusRef.current = true;
    } catch {
      if (isCurrent(sequence, expectedOwnerKey)) {
        setNotice("failed");
        pendingDraftFocusRef.current = true;
      }
    } finally {
      if (activeRequestRef.current === sequence) activeRequestRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const addValid = draft?.mode === "add" && draft.label.trim().length > 0 &&
    props.snapshot.canAddRelationColumn &&
    !!targetSnapshot?.columns.some((column) =>
      column.columnId === draft.targetDisplayColumnId && column.canUseAsRelationDisplay
    );
  if (!draft && !props.snapshot.canAddRelationColumn && !notice) return null;
  return (
    <section className="settings-card settings-row tall" aria-label={props.t((draft?.mode ?? noticeMode) === "edit" ? "collection.relationEditor" : "collection.relationBuilder")}>
      {!draft ? props.snapshot.canAddRelationColumn ? (
        <div className="settings-row-control">
          <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy} onClick={beginAdd}>
            {props.t("collection.addRelationField")}
          </button>
        </div>
      ) : null : (
        <form
          aria-label={props.t(draft.mode === "edit" ? "collection.relationEditor" : "collection.relationBuilder")}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelDraft(); } }}
        >
          {draft.mode === "add" ? (
            <>
              <div className="settings-row-copy">
                <label htmlFor="collection-relation-name"><strong>{props.t("collection.fieldName")}</strong></label>
                <input ref={nameRef} id="collection-relation-name" className="settings-input" value={draft.label} maxLength={120} disabled={busy} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setNotice(null); }} />
              </div>
              <div className="settings-row-copy">
                <label htmlFor="collection-relation-table"><strong>{props.t("collection.relationTargetTable")}</strong></label>
                <select id="collection-relation-table" className="settings-input" value={draft.targetTableId} disabled={busy || browsing} onChange={(event) => chooseTargetTable(event.target.value)}>
                  {targetTables.map((table) => <option key={table.tableId} value={table.tableId}>{table.tableName}</option>)}
                </select>
              </div>
              <div className="settings-row-copy">
                <label htmlFor="collection-relation-display"><strong>{props.t("collection.relationDisplayField")}</strong></label>
                <select id="collection-relation-display" className="settings-input" value={draft.targetDisplayColumnId} disabled={busy || browsing || !targetSnapshot} onChange={(event) => { setDraft({ ...draft, targetDisplayColumnId: event.target.value }); setNotice(null); }}>
                  {targetSnapshot?.columns.filter((column) => column.canUseAsRelationDisplay).map((column) => <option key={column.columnId} value={column.columnId}>{column.label}</option>)}
                </select>
              </div>
              {targetSnapshot && !targetSnapshot.columns.some((column) => column.canUseAsRelationDisplay) ? <p className="muted" role="status">{props.t("collection.relationNoDisplayField")}</p> : null}
            </>
          ) : (
            <div ref={targetListRef} className="settings-row-copy" tabIndex={-1} aria-label={props.t("collection.relationTarget")}>
              <strong>{props.t("collection.relationTarget")}</strong>
              <button type="button" className="settings-button" aria-pressed={draft.targetRowId === null} disabled={busy || browsing} onClick={() => { setDraft({ ...draft, targetRowId: null }); setNotice(null); }}>
                {props.t("collection.relationClear")}
              </button>
              {targetRows.map((row) => {
                const relation = relationForEdit(props.snapshot, draft.columnId);
                const value = row.cells.find((cell) => cell.columnId === relation?.targetDisplayColumnId)?.value;
                const label = value === undefined ? "" : formatCollectionCellValue(value);
                return <button key={row.rowId} type="button" className="settings-button" aria-pressed={draft.targetRowId === row.rowId} disabled={busy || browsing} onClick={() => { setDraft({ ...draft, targetRowId: row.rowId }); setNotice(null); }}>
                  {label || props.t("collection.relationEmptyTarget")}
                </button>;
              })}
              {nextRowCursor ? <button type="button" className="settings-button" disabled={busy || browsing} onClick={() => { const relation = relationForEdit(props.snapshot, draft.columnId); if (relation) void loadTargetPage(relation.targetTableId, nextRowCursor, false); }}>{props.t("collection.loadMoreRows")}</button> : null}
            </div>
          )}
          {browsing ? <p className="muted" role="status">{props.t("collection.relationLoading")}</p> : null}
          {browseFailed ? <p className="settings-inline-status error" role="status">{props.t("collection.relationLoadFailed")}</p> : null}
          <div className="settings-row-control">
            <button type="submit" className="settings-button primary" disabled={busy || browsing || props.blocked || (draft.mode === "add" ? !addValid : !relationEditStillEligible(draft) || draft.targetRowId === draft.originalTargetRowId)}>{props.t(busy ? "collection.saving" : "collection.save")}</button>
            <button type="button" className="settings-button" disabled={busy} onClick={cancelDraft}>{props.t("collection.cancel")}</button>
          </div>
        </form>
      )}
      {notice ? <p className={`settings-inline-status ${notice === "added" || notice === "saved" ? "success" : "error"}`} role="status">{props.t(`collection.relation_${notice}`)}</p> : null}
    </section>
  );

  async function loadCurrentDatasetTables(): Promise<void> {
    if (browseActiveRef.current) return;
    browseActiveRef.current = true;
    const sequence = browseSequence.current + 1;
    browseSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    setBrowsing(true);
    setBrowseFailed(false);
    let cursor: string | undefined;
    const seen = new Set<string>();
    try {
      for (;;) {
        const result = await window.pige.collections.list({ apiVersion: 1, activeVaultId: props.activeVaultId, limit: 50, ...(cursor ? { cursor } : {}) });
        if (sequence !== browseSequence.current || ownerKeyRef.current !== expectedOwnerKey) return;
        if (result.apiVersion !== 1 || result.activeVaultId !== props.activeVaultId || result.status !== "ready") throw new Error("catalog_failed");
        const dataset = result.datasets.find((candidate) => candidate.datasetId === props.snapshot.datasetId);
        if (dataset) {
          const projected = dataset.tables.filter((table) => table.canOpen).map(({ tableId, tableName }) => ({ tableId, tableName }));
          setTargetTables(projected.some((table) => table.tableId === props.snapshot.tableId)
            ? projected
            : [{ tableId: props.snapshot.tableId, tableName: props.snapshot.tableName }, ...projected]);
          return;
        }
        if (!result.nextCursor || seen.has(result.nextCursor)) throw new Error("dataset_not_found");
        seen.add(result.nextCursor);
        cursor = result.nextCursor;
      }
    } catch {
      if (sequence === browseSequence.current && ownerKeyRef.current === expectedOwnerKey) setBrowseFailed(true);
    } finally {
      if (sequence === browseSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        browseActiveRef.current = false;
        setBrowsing(false);
      }
    }
  }

  async function loadTargetPage(targetTableId: string, rowCursor: string | undefined, replace: boolean): Promise<void> {
    if (browseActiveRef.current) return;
    browseActiveRef.current = true;
    const sequence = browseSequence.current + 1;
    browseSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    const request: CollectionOpenRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: targetTableId,
      limit: 50,
      ...(rowCursor ? { rowCursor } : {})
    };
    setBrowsing(true);
    setBrowseFailed(false);
    try {
      const result = await window.pige.collections.open(request);
      if (sequence !== browseSequence.current || ownerKeyRef.current !== expectedOwnerKey || !openIdentityMatches(request, result)) return;
      if (result.status !== "ready" || result.snapshot.activeViewId !== undefined) throw new Error("target_failed");
      if (!replace && targetSnapshot && targetPageIdentity(targetSnapshot) !== targetPageIdentity(result.snapshot)) {
        throw new Error("target_changed");
      }
      adoptTargetSnapshot(result.snapshot, result.nextRowCursor, replace);
    } catch {
      if (sequence === browseSequence.current && ownerKeyRef.current === expectedOwnerKey) setBrowseFailed(true);
    } finally {
      if (sequence === browseSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        browseActiveRef.current = false;
        setBrowsing(false);
      }
    }
  }

  function adoptTargetSnapshot(snapshot: CollectionSnapshot, cursor: string | undefined, replace: boolean): void {
    setTargetSnapshot(snapshot);
    setTargetRows((current) => replace ? snapshot.rows : mergeRows(current, snapshot.rows));
    setNextRowCursor(cursor);
    setDraft((current) => {
      if (!current || current.mode !== "add" || current.targetTableId !== snapshot.tableId) return current;
      const eligible = snapshot.columns.filter((column) => column.canUseAsRelationDisplay);
      return eligible.some((column) => column.columnId === current.targetDisplayColumnId)
        ? current
        : { ...current, targetDisplayColumnId: eligible[0]?.columnId ?? "" };
    });
  }

  function relationEditStillEligible(identity: Pick<CollectionEditRelationCellRequest, "rowId" | "columnId">): boolean {
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === identity.columnId);
    return !!column?.canEditRelation && !!column.relation && props.snapshot.rows.some((row) => row.rowId === identity.rowId);
  }

  function isCurrent(sequence: number, expectedOwnerKey: string, expectedRevisionId?: string): boolean {
    return sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey &&
      (expectedRevisionId === undefined || revisionRef.current === expectedRevisionId);
  }
}

function relationForEdit(snapshot: CollectionSnapshot, columnId: string) {
  return snapshot.columns.find((column) => column.columnId === columnId)?.relation;
}

function relationTargetInSnapshot(snapshot: CollectionSnapshot, rowId: string, columnId: string): string | null {
  const value = snapshot.rows.find((row) => row.rowId === rowId)?.cells.find((cell) => cell.columnId === columnId)?.value;
  return typeof value === "object" && value?.kind === "relation" ? value.targetRowId : null;
}

function mergeRows(current: CollectionSnapshot["rows"], incoming: CollectionSnapshot["rows"]): CollectionSnapshot["rows"] {
  const seen = new Set(current.map((row) => row.rowId));
  return [...current, ...incoming.filter((row) => !seen.has(row.rowId))];
}

function targetPageIdentity(snapshot: CollectionSnapshot): string {
  return JSON.stringify([snapshot.datasetId, snapshot.revisionId, snapshot.tableId, snapshot.activeViewId ?? null]);
}

function identityMatches(
  request: CollectionAddRelationColumnRequest | CollectionEditRelationCellRequest,
  result: Awaited<ReturnType<typeof window.pige.collections.addRelationColumn>> | Awaited<ReturnType<typeof window.pige.collections.editRelationCell>>
): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId && result.tableId === request.tableId &&
    ("label" in request
      ? "targetTableId" in result && result.targetTableId === request.targetTableId && result.targetDisplayColumnId === request.targetDisplayColumnId
      : "rowId" in result && result.rowId === request.rowId && result.columnId === request.columnId && result.targetRowId === request.targetRowId);
}

function openIdentityMatches(request: CollectionOpenRequest, result: CollectionOpenResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId && result.tableId === request.tableId;
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
