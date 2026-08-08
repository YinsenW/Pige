import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionCreateViewRequest, CollectionCreateViewResult,
  CollectionUpdateViewRequest, CollectionUpdateViewResult,
  CollectionRenameViewRequest, CollectionRenameViewResult,
  CollectionTrashViewRequest, CollectionTrashViewResult,
  CollectionOpenResult,
  CollectionOpenRelatedRecordsRequest,
  CollectionOpenRelatedRecordsResult,
  CollectionRevealRequest, CollectionRevealResult,
  CollectionOpenCitationResult,
  CollectionRenameColumnRequest, CollectionRenameColumnResult,
  CollectionRenameTableRequest, CollectionRenameTableResult,
  CollectionScalarValue,
  CollectionSnapshot,
  CollectionTrashColumnRequest,
  CollectionTrashColumnResult,
  CollectionTrashRowRequest,
  CollectionTrashRowResult,
  DatasetLogicalType
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";
import {
  ManagedCollectionColumnActions,
  type CollectionColumnActionNotice
} from "./ManagedCollectionColumnActions";
import { ManagedCollectionViewControls } from "./ManagedCollectionViewControls";
import { ManagedCollectionFormulaColumnDialog } from "./ManagedCollectionFormulaColumnDialog";
import { ManagedCollectionRelationDialog } from "./ManagedCollectionRelationDialog"; import { ManagedCollectionLookupDialog } from "./ManagedCollectionLookupDialog";
import { ManagedCollectionRollupDialog } from "./ManagedCollectionRollupDialog"; import { ManagedCollectionRevealAction } from "./ManagedCollectionRevealAction"; import { ManagedCollectionTableAddAction } from "./ManagedCollectionTableAddAction"; import { ManagedCollectionTableRenameAction } from "./ManagedCollectionTableRenameAction"; import { ManagedCollectionTableTrashAction } from "./ManagedCollectionTableTrashAction"; import { ManagedCollectionRevisionHistory } from "./ManagedCollectionRevisionHistory";
import { ManagedCollectionRelatedRecordPanel } from "./ManagedCollectionRelatedRecords";
import { AnalyticalSnapshotPanel } from "./AnalyticalSnapshotPanel";
import {
  ManagedCollectionScalarCellEditor,
  formatCollectionCellValue,
  isCollectionScalarValue,
  parseCollectionScalar
} from "./ManagedCollectionScalarCellEditor";
type CellIdentity = {
  readonly rowId: string;
  readonly columnId: string;
};
type CellEdit = CellIdentity & {
  readonly expectedRevisionId: string;
  readonly logicalType: DatasetLogicalType;
  readonly originalValue: CollectionScalarValue;
  readonly draft: string;
};
type ColumnDraft = {
  readonly expectedRevisionId: string;
  readonly label: string;
  readonly logicalType: CollectionAddNullableColumnRequest["logicalType"];
};
const COLLECTION_EDITABLE_TYPES = ["string", "integer", "number", "boolean", "date", "datetime"] as const;
type CitationReady = Extract<CollectionOpenCitationResult, { readonly status: "ready" }>;
type CitationPanelProps = Pick<CitationReady, "mode" | "preview" | "highlights"> & { readonly onClose: () => void; readonly t: (key: string) => string };
export function ManagedCollectionCitationPanel(props: CitationPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null);
  const primary = props.highlights[0];
  const rowIds = new Set(props.highlights.find((item) => item.kind === "rows")?.rowIds ?? []);
  const range = props.highlights.find((item) => item.kind === "range")?.range;
  const columnIds = new Set(props.highlights.find((item) => item.kind === "columns")?.columnIds ?? []);
  const aggregate = props.highlights.find((item) => item.kind === "aggregate");
  const aggregateKeys = new Set(aggregate?.kind === "aggregate" ? [...aggregate.aggregateKeys, ...aggregate.groupKeys] : []);
  const rowMarked = (rowId: string | undefined) => !!(rowId && rowIds.has(rowId));
  const columnMarked = (column: CitationReady["preview"]["columns"][number]) => !!(column.sourceColumnId && columnIds.has(column.sourceColumnId)) || aggregateKeys.has(column.key);
  const primaryRow = (rowId: string | undefined) => primary?.kind === "rows" && rowId === primary.rowIds[0];
  const primaryColumn = (column: CitationReady["preview"]["columns"][number]) => primary?.kind === "columns" ? column.sourceColumnId === primary.columnIds[0] : primary?.kind === "aggregate" && column.key === (primary.aggregateKeys[0] ?? primary.groupKeys[0]);
  useLayoutEffect(() => { const panel = panelRef.current; (panel?.querySelector<HTMLElement>('[data-citation-primary="true"]') ?? panel)?.focus({ preventScroll: true }); }, [props.preview.resultHash, props.highlights]);
  return <section ref={panelRef} className="dataset-answer managed-collection-panel managed-collection-citation-panel" aria-labelledby="managed-collection-citation-title" tabIndex={-1} data-collection-mode={props.mode}>
    <header className="dataset-answer-header"><div><button type="button" className="ghost back-button" onClick={props.onClose}>{props.t("collection.back")}</button><p className="retrieval-eyebrow">{props.t("dataset.result")}</p><h1 id="managed-collection-citation-title">{props.preview.tableName}</h1></div><p className="muted dataset-answer-count">{props.t("dataset.rows")}: {props.preview.returnedRowCount}/{props.preview.matchedRowCount}</p></header>
    {range ? <p className="muted dataset-answer-count" tabIndex={-1} data-citation-range={`${range.startRow}:${range.endRow}`} data-citation-primary={primary?.kind === "range" ? "true" : undefined}>{props.t("dataset.rows")}: {range.startRow}–{range.endRow}</p> : null}
    <div className="dataset-table-scroll" tabIndex={0} aria-label={props.t("dataset.table")}><table className="dataset-table"><caption>{props.preview.tableName}</caption><thead><tr>
      {props.preview.columns.map((column) => <th scope="col" key={column.key} tabIndex={-1} data-citation-highlight={columnMarked(column) ? "true" : undefined} data-citation-primary={primaryColumn(column) ? "true" : undefined}>{columnMarked(column) ? <mark>{column.label}</mark> : column.label}</th>)}
    </tr></thead><tbody>{props.preview.rows.map((row, rowIndex) => <tr key={row.rowId ?? `${props.preview.resultHash}:${rowIndex}`} tabIndex={-1} data-citation-row-id={row.rowId} data-citation-highlight={rowMarked(row.rowId) ? "true" : undefined} data-citation-primary={primaryRow(row.rowId) ? "true" : undefined}>
      {row.values.map((value, columnIndex) => { const column = props.preview.columns[columnIndex]; const marked = rowMarked(row.rowId) || !!(column && columnMarked(column)); const content = formatCollectionCellValue(value); return <td key={column?.key ?? columnIndex}>{marked ? <mark>{content}</mark> : content}</td>; })}
    </tr>)}</tbody></table></div>
    {props.preview.truncated ? <p className="muted retrieval-warning">{props.t("dataset.truncated")}</p> : null}
  </section>;
}

type EditNotice =
  | { readonly kind: "saved" }
  | { readonly kind: "row_added" }
  | { readonly kind: "append_stale" }
  | { readonly kind: "append_not_found" }
  | { readonly kind: "append_failed" }
  | { readonly kind: "row_trashed" }
  | { readonly kind: "trash_stale" }
  | { readonly kind: "trash_not_found" }
  | { readonly kind: "trash_ineligible" }
  | { readonly kind: "trash_failed" }
  | { readonly kind: "column_added" }
  | { readonly kind: "column_stale" }
  | { readonly kind: "column_not_found" }
  | { readonly kind: "column_failed" }
  | { readonly kind: "column_duplicate_label" }
  | { readonly kind: "column_limit" }
  | { readonly kind: "column_type_mismatch" }
  | { readonly kind: CollectionColumnActionNotice }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid" }
  | { readonly kind: "not_editable" }
  | { readonly kind: "failed" };

export function ManagedCollectionPanel(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly nextRowCursor?: string;
  readonly onClose: () => void;
  readonly onReveal?: (request: CollectionRevealRequest) => Promise<CollectionRevealResult>;
  readonly onAppendDefaultRow: (request: CollectionAppendDefaultRowRequest) => Promise<CollectionAppendDefaultRowResult>;
  readonly onTrashRow: (request: CollectionTrashRowRequest) => Promise<CollectionTrashRowResult>;
  readonly onAddNullableColumn: (request: CollectionAddNullableColumnRequest) => Promise<CollectionAddNullableColumnResult>;
  readonly onRenameColumn: (request: CollectionRenameColumnRequest) => Promise<CollectionRenameColumnResult>;
  readonly onRenameTable: (request: CollectionRenameTableRequest) => Promise<CollectionRenameTableResult>;
  readonly onTrashColumn: (request: CollectionTrashColumnRequest) => Promise<CollectionTrashColumnResult>;
  readonly onOpenView: (viewId?: string) => Promise<CollectionSnapshot | null>;
  readonly onCreateView: (
    request: CollectionCreateViewRequest
  ) => Promise<CollectionCreateViewResult>;
  readonly onUpdateView: (request: CollectionUpdateViewRequest) => Promise<CollectionUpdateViewResult>;
  readonly onRenameView: (request: CollectionRenameViewRequest) => Promise<CollectionRenameViewResult>;
  readonly onTrashView: (request: CollectionTrashViewRequest) => Promise<CollectionTrashViewResult>;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string, expectedTableId?: string) => boolean;
  readonly onEditCell: (request: CollectionCellEditRequest) => Promise<CollectionCellEditResult>;
  readonly onOpenRelatedRecords?: (request: CollectionOpenRelatedRecordsRequest) => Promise<CollectionOpenRelatedRecordsResult>;
  readonly onReload: () => Promise<CollectionSnapshot | null>;
  readonly onLoadMoreRows?: (rowCursor: string) => Promise<CollectionOpenResult | null>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [columnDraft, setColumnDraft] = useState<ColumnDraft | null>(null);
  const [notice, setNotice] = useState<EditNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [columnActionsBusy, setColumnActionsBusy] = useState(false);
  const [viewControlsBusy, setViewControlsBusy] = useState(false); const [formulaActive, setFormulaActive] = useState(false);
  const [relationActive, setRelationActive] = useState(false); const [lookupActive, setLookupActive] = useState(false); const [rollupActive, setRollupActive] = useState(false);
  const [columnFocusRequest, setColumnFocusRequest] = useState<string | null>(null);
  const [cellFocusRequest, setCellFocusRequest] = useState<CellIdentity | null>(null);
  const [formulaEditRequest, setFormulaEditRequest] = useState<{ readonly columnId: string; readonly ownerKey: string; readonly revisionId: string } | null>(null);
  const [relationEditRequest, setRelationEditRequest] = useState<{ readonly kind: "cell" | "definition"; readonly rowId?: string; readonly columnId: string; readonly ownerKey: string; readonly revisionId: string } | null>(null);
  const [relatedRecordResult, setRelatedRecordResult] = useState<CollectionOpenRelatedRecordsResult | null>(null);
  const [relatedRecordBusy, setRelatedRecordBusy] = useState(false);
  const [visibleRows, setVisibleRows] = useState<CollectionSnapshot["rows"]>(props.snapshot.rows);
  const [nextRowCursor, setNextRowCursor] = useState(props.nextRowCursor);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsLoadFailed, setRowsLoadFailed] = useState(false);
  const requestSequence = useRef(0);
  const relatedRequestSequence = useRef(0);
  const relatedActiveRef = useRef<number | null>(null);
  const appendActiveRef = useRef<number | null>(null);
  const appendTriggerRef = useRef<HTMLButtonElement | null>(null);
  const trashActiveRef = useRef<{ readonly sequence: number; readonly rowId: string } | null>(null);
  const trashTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const columnActiveRef = useRef<number | null>(null);
  const columnTriggerRef = useRef<HTMLButtonElement | null>(null);
  const columnLabelRef = useRef<HTMLInputElement | null>(null);
  const columnActionsActiveRef = useRef(false);
  const formulaActiveRef = useRef(false);
  const relationActiveRef = useRef(false); const lookupActiveRef = useRef(false); const rollupActiveRef = useRef(false);
  const viewControlsActiveRef = useRef(false);
  const editTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const relatedRecordTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const relatedRecordOriginKeyRef = useRef<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocusRef = useRef<CellIdentity | null>(null);
  const pendingAppendFocusRef = useRef(false);
  const pendingRowFocusRef = useRef<string | null>(null);
  const pendingTrashFocusRef = useRef<{
    readonly rowId: string | null;
    readonly preferAction: boolean;
  } | null>(null);
  const pendingColumnTriggerFocusRef = useRef(false);
  const pendingColumnEditorFocusRef = useRef(false);
  const editorRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rowsLoadActiveRef = useRef(false);
  const pendingRowsFocusRef = useRef<{ readonly paginationKey: string; readonly scrollTop: number } | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const paginationKey = collectionPaginationIdentity(props.activeVaultId, props.snapshot);
  const paginationKeyRef = useRef(paginationKey);
  const ownerKeyRef = useRef(ownerKey);
  const snapshotRevisionRef = useRef(props.snapshot.revisionId);
  ownerKeyRef.current = ownerKey;
  snapshotRevisionRef.current = props.snapshot.revisionId;
  paginationKeyRef.current = paginationKey;
  useEffect(() => {
    requestSequence.current += 1;
    relatedRequestSequence.current += 1;
    relatedActiveRef.current = null;
    appendActiveRef.current = null;
    trashActiveRef.current = null;
    columnActiveRef.current = null;
    columnActionsActiveRef.current = false;
    formulaActiveRef.current = false;
    relationActiveRef.current = false;
    lookupActiveRef.current = false;
    rollupActiveRef.current = false;
    viewControlsActiveRef.current = false;
    pendingFocusRef.current = null;
    pendingAppendFocusRef.current = false;
    pendingRowFocusRef.current = null;
    pendingTrashFocusRef.current = null;
    pendingColumnTriggerFocusRef.current = false;
    pendingColumnEditorFocusRef.current = false;
    relatedRecordOriginKeyRef.current = null;
    setEdit(null);
    setColumnDraft(null);
    setNotice(null);
    setBusy(false);
    setColumnActionsBusy(false);
    setViewControlsBusy(false);
    setFormulaActive(false);
    setRelationActive(false); setLookupActive(false); setRollupActive(false);
    setColumnFocusRequest(null);
    setCellFocusRequest(null);
    setFormulaEditRequest(null);
    setRelationEditRequest(null);
    setRelatedRecordResult(null);
    setRelatedRecordBusy(false);
  }, [ownerKey]);
  useEffect(() => {
    rowsLoadActiveRef.current = false;
    setVisibleRows(props.snapshot.rows);
    setNextRowCursor(props.nextRowCursor);
    setRowsLoading(false);
    setRowsLoadFailed(false);
  }, [paginationKey]);
  useEffect(() => {
    if (edit) editorRef.current?.focus();
  }, [edit?.rowId, edit?.columnId]);
  useEffect(() => {
    if (columnDraft && !busy) columnLabelRef.current?.focus();
  }, [columnDraft?.expectedRevisionId]);
  useLayoutEffect(() => {
    if (edit || !pendingFocusRef.current) return;
    const button = editTriggerRefs.current.get(cellKey(pendingFocusRef.current));
    if (!button) return;
    pendingFocusRef.current = null;
    button.focus();
  }, [edit]);
  useLayoutEffect(() => {
    if (!cellFocusRequest) return;
    const button = editTriggerRefs.current.get(cellKey(cellFocusRequest));
    setCellFocusRequest(null);
    (button ?? panelRef.current)?.focus();
  }, [cellFocusRequest, props.snapshot.revisionId]);
  useLayoutEffect(() => {
    const result = relatedRecordResult;
    if (!result || result.status === "ready" || result.status === "empty") return;
    const trigger = relatedRecordOriginKeyRef.current
      ? relatedRecordTriggerRefs.current.get(relatedRecordOriginKeyRef.current)
      : undefined;
    (trigger ?? panelRef.current)?.focus({ preventScroll: true });
  }, [relatedRecordResult]);
  useLayoutEffect(() => {
    if (busy) return;
    if (pendingTrashFocusRef.current) {
      const pending = pendingTrashFocusRef.current;
      const target = pending.rowId
        ? (pending.preferAction ? trashTriggerRefs.current.get(pending.rowId) : null) ?? rowRefs.current.get(pending.rowId)
        : panelRef.current;
      if (target) {
        pendingTrashFocusRef.current = null;
        target.focus();
        return;
      }
    }
    if (pendingRowFocusRef.current) {
      const row = rowRefs.current.get(pendingRowFocusRef.current);
      if (row) {
        pendingRowFocusRef.current = null;
        row.focus();
        return;
      }
    }
    if (!pendingAppendFocusRef.current) return;
    pendingAppendFocusRef.current = false;
    (appendTriggerRef.current ?? panelRef.current)?.focus();
  }, [busy, notice, props.snapshot.revisionId, visibleRows]);
  useLayoutEffect(() => {
    const pending = pendingRowsFocusRef.current;
    if (!pending || pending.paginationKey !== paginationKey) return;
    pendingRowsFocusRef.current = null;
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = pending.scrollTop;
    loadMoreTriggerRef.current?.focus({ preventScroll: true });
  }, [paginationKey, visibleRows]);
  useLayoutEffect(() => {
    if (rowsLoadFailed && !rowsLoading) loadMoreTriggerRef.current?.focus({ preventScroll: true });
  }, [rowsLoadFailed, rowsLoading]);
  useLayoutEffect(() => {
    if (busy) return;
    if (pendingColumnEditorFocusRef.current && columnDraft) {
      pendingColumnEditorFocusRef.current = false;
      columnLabelRef.current?.focus();
      return;
    }
    if (!pendingColumnTriggerFocusRef.current || columnDraft) return;
    pendingColumnTriggerFocusRef.current = false;
    (columnTriggerRef.current ?? panelRef.current)?.focus();
  }, [busy, columnDraft, notice, props.snapshot.revisionId]);
  const restoreCellFocus = (identity: CellIdentity): void => {
    pendingFocusRef.current = identity;
  };
  const stopEditing = (restoreFocus: boolean): void => {
    const identity = edit;
    setEdit(null);
    setNotice(null);
    if (restoreFocus && identity) restoreCellFocus(identity);
  };

  const submitEdit = async (): Promise<void> => {
    if (!edit || busy || columnActionsActiveRef.current || viewControlsActiveRef.current) return;
    const value = parseCollectionScalar(edit.draft, edit.logicalType, edit.originalValue);
    if (value === undefined) {
      setNotice({ kind: "invalid" });
      return;
    }
    const request: CollectionCellEditRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      expectedRevisionId: edit.expectedRevisionId,
      tableId: props.snapshot.tableId,
      rowId: edit.rowId,
      columnId: edit.columnId,
      value
    };
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = await props.onEditCell(request);
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        !collectionEditIdentityMatches(request, result)
      ) return;
      if (result.status === "committed") {
        const next = await props.onReload();
        if (
          sequence !== requestSequence.current ||
          ownerKeyRef.current !== expectedOwnerKey
        ) return;
        if (
          !next ||
          next.datasetId !== request.datasetId ||
          next.tableId !== request.tableId ||
          next.revisionId !== result.revisionId
        ) {
          setNotice({ kind: "failed" });
          return;
        }
        setEdit(null);
        setNotice({ kind: "saved" });
        restoreCellFocus(request);
        return;
      }
      setNotice({
        kind: result.status === "stale"
          ? "stale"
          : result.status === "not_editable"
            ? "not_editable"
            : result.status === "invalid"
              ? "invalid"
              : "failed"
      });
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setNotice({ kind: "failed" });
      }
    } finally {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const reloadAfterStale = async (): Promise<void> => {
    if (!edit || busy) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    try {
      const next = await props.onReload();
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        !next ||
        next.datasetId !== props.snapshot.datasetId ||
        next.tableId !== props.snapshot.tableId
      ) return;
      setEdit((current) => current ? { ...current, expectedRevisionId: next.revisionId } : current);
      setNotice(null);
      window.requestAnimationFrame(() => editorRef.current?.focus());
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setNotice({ kind: "failed" });
      }
    } finally {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const appendDefaultRow = async (): Promise<void> => {
    if (!props.snapshot.canAppendDefaultRow || busy || edit || columnDraft || columnActionsActiveRef.current || viewControlsActiveRef.current || appendActiveRef.current !== null || trashActiveRef.current) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    appendActiveRef.current = sequence;
    const request: CollectionAppendDefaultRowRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: props.snapshot.revisionId
    };
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = await props.onAppendDefaultRow(request);
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        snapshotRevisionRef.current !== request.expectedRevisionId ||
        !collectionIdentityMatches(request, result)
      ) return;
      if (result.status !== "not_found" && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        pendingRowFocusRef.current = result.rowId;
        setNotice({ kind: "row_added" });
        return;
      }
      pendingAppendFocusRef.current = true;
      setNotice({ kind: result.status === "stale" ? "append_stale" : "append_not_found" });
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        pendingAppendFocusRef.current = true;
        setNotice({ kind: "append_failed" });
      }
    } finally {
      if (appendActiveRef.current === sequence) appendActiveRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const trashRow = async (rowId: string, rowIndex: number): Promise<void> => {
    const row = visibleRows.find((candidate) => candidate.rowId === rowId);
    if (!row?.canTrash || busy || edit || columnDraft || columnActionsActiveRef.current || viewControlsActiveRef.current || trashActiveRef.current) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    trashActiveRef.current = { sequence, rowId };
    const request: CollectionTrashRowRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: props.snapshot.revisionId,
      rowId
    };
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = await props.onTrashRow(request);
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        snapshotRevisionRef.current !== request.expectedRevisionId ||
        (!collectionIdentityMatches(request, result) || result.rowId !== request.rowId)
      ) return;
      if ((result.status === "committed" || result.status === "stale") &&
          !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        pendingTrashFocusRef.current = {
          rowId: result.snapshot.rows[rowIndex]?.rowId ?? result.snapshot.rows[rowIndex - 1]?.rowId ?? null,
          preferAction: false
        };
        setNotice({ kind: "row_trashed" });
        return;
      }
      pendingTrashFocusRef.current = { rowId, preferAction: true };
      setNotice({
        kind: result.status === "stale"
          ? "trash_stale"
          : result.status === "not_found"
            ? "trash_not_found"
            : result.status === "ineligible"
              ? "trash_ineligible"
              : "trash_failed"
      });
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        pendingTrashFocusRef.current = { rowId, preferAction: true };
        setNotice({ kind: "trash_failed" });
      }
    } finally {
      if (trashActiveRef.current?.sequence === sequence) trashActiveRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const hasTrashActions = visibleRows.some((row) => row.canTrash);

  const openRelatedRecords = async (identity: CellIdentity): Promise<void> => {
    const openRelatedRecordsHandler = props.onOpenRelatedRecords;
    if (!openRelatedRecordsHandler || busy || columnActionsBusy || viewControlsBusy || columnDraft || relatedActiveRef.current !== null) return;
    const sequence = relatedRequestSequence.current + 1;
    relatedRequestSequence.current = sequence;
    relatedActiveRef.current = sequence;
    relatedRecordOriginKeyRef.current = cellKey(identity);
    const request: CollectionOpenRelatedRecordsRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      sourceTableId: props.snapshot.tableId,
      sourceColumnId: identity.columnId,
      sourceRowId: identity.rowId,
      expectedRevisionId: props.snapshot.revisionId
    };
    const expectedOwnerKey = ownerKey;
    setRelatedRecordBusy(true);
    setRelatedRecordResult(null);
    try {
      const result = await openRelatedRecordsHandler(request);
      if (sequence !== relatedRequestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
          !collectionRelatedRecordIdentityMatches(request, result)) return;
      setRelatedRecordResult(result);
    } catch {
      if (sequence === relatedRequestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setRelatedRecordResult({ ...request, status: "failed" });
      }
    } finally {
      if (relatedActiveRef.current === sequence) relatedActiveRef.current = null;
      if (sequence === relatedRequestSequence.current && ownerKeyRef.current === expectedOwnerKey) setRelatedRecordBusy(false);
    }
  };

  const closeRelatedRecords = (): void => {
    const trigger = relatedRecordOriginKeyRef.current
      ? relatedRecordTriggerRefs.current.get(relatedRecordOriginKeyRef.current)
      : undefined;
    relatedRecordOriginKeyRef.current = null;
    setRelatedRecordResult(null);
    (trigger ?? panelRef.current)?.focus({ preventScroll: true });
  };

  const loadMoreRows = async (): Promise<void> => {
    const cursor = nextRowCursor;
    if (!cursor || !props.onLoadMoreRows || rowsLoadActiveRef.current || busy || columnActionsBusy || viewControlsBusy || edit || columnDraft) return;
    const expectedPaginationKey = paginationKey;
    const scrollTop = tableScrollRef.current?.scrollTop ?? 0;
    rowsLoadActiveRef.current = true;
    setRowsLoading(true);
    setRowsLoadFailed(false);
    try {
      const result = await props.onLoadMoreRows(cursor);
      if (paginationKeyRef.current !== expectedPaginationKey) return;
      if (
        !result || result.status !== "ready" ||
        collectionPaginationIdentity(props.activeVaultId, result.snapshot) !== expectedPaginationKey
      ) {
        setRowsLoadFailed(true);
        return;
      }
      setVisibleRows((current) => {
        const known = new Set(current.map(({ rowId }) => rowId));
        return [...current, ...result.snapshot.rows.filter(({ rowId }) => !known.has(rowId))];
      });
      setNextRowCursor(result.nextRowCursor);
      pendingRowsFocusRef.current = { paginationKey: expectedPaginationKey, scrollTop };
    } catch {
      if (paginationKeyRef.current === expectedPaginationKey) setRowsLoadFailed(true);
    } finally {
      if (paginationKeyRef.current === expectedPaginationKey) {
        rowsLoadActiveRef.current = false;
        setRowsLoading(false);
      }
    }
  };

  const addNullableColumn = async (): Promise<void> => {
    if (!columnDraft || busy || columnActionsActiveRef.current || viewControlsActiveRef.current || columnActiveRef.current !== null) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    columnActiveRef.current = sequence;
    const request: CollectionAddNullableColumnRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: columnDraft.expectedRevisionId,
      label: columnDraft.label,
      logicalType: columnDraft.logicalType
    };
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = await props.onAddNullableColumn(request);
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        snapshotRevisionRef.current !== request.expectedRevisionId ||
        !collectionIdentityMatches(request, result)
      ) return;
      if ((result.status === "committed" || result.status === "stale") &&
          !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setColumnFocusRequest(result.columnId);
        setColumnDraft(null);
        setNotice({ kind: "column_added" });
        return;
      }
      if (result.status === "stale") {
        pendingColumnEditorFocusRef.current = true;
        setColumnDraft((current) => current ? {
          ...current,
          expectedRevisionId: result.snapshot.revisionId
        } : current);
        setNotice({ kind: "column_stale" });
        return;
      }
      pendingColumnEditorFocusRef.current = true;
      setNotice({
        kind: result.status === "not_found"
          ? "column_not_found"
          : result.reason === "duplicate_label"
            ? "column_duplicate_label"
            : result.reason === "column_limit"
              ? "column_limit"
              : "column_type_mismatch"
      });
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        pendingColumnEditorFocusRef.current = true;
        setNotice({ kind: "column_failed" });
      }
    } finally {
      if (columnActiveRef.current === sequence) columnActiveRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const cancelColumnDraft = (): void => {
    if (busy) return;
    pendingColumnTriggerFocusRef.current = true;
    setColumnDraft(null);
    setNotice(null);
  };

  return (
    <section
      ref={panelRef}
      className="dataset-answer managed-collection-panel"
      aria-labelledby="managed-collection-title"
      tabIndex={-1}
      data-collection-dataset-id={props.snapshot.datasetId}
      data-collection-revision-id={props.snapshot.revisionId}
    >
      <header className="dataset-answer-header">
        <div>
          <button type="button" className="ghost back-button" onClick={props.onClose}>
            {props.t("collection.back")}
          </button>
          <p className="retrieval-eyebrow">{props.t("collection.title")}</p>
          <h1 id="managed-collection-title">{props.snapshot.title}</h1>
          <ManagedCollectionTableRenameAction activeVaultId={props.activeVaultId} snapshot={props.snapshot} blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
            onRename={props.onRenameTable} onAdoptSnapshot={props.onAdoptSnapshot} onBusyChange={(active) => { viewControlsActiveRef.current = active; setViewControlsBusy(active); }} t={props.t} /><ManagedCollectionTableAddAction activeVaultId={props.activeVaultId} snapshot={props.snapshot} blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null} onAdoptSnapshot={props.onAdoptSnapshot} onBusyChange={(active) => { viewControlsActiveRef.current = active; setViewControlsBusy(active); }} t={props.t} /><ManagedCollectionTableTrashAction activeVaultId={props.activeVaultId} snapshot={props.snapshot} blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null} onAdoptSnapshot={props.onAdoptSnapshot} onTrashed={props.onClose} onBusyChange={(active) => { viewControlsActiveRef.current = active; setViewControlsBusy(active); }} t={props.t} />
        </div>
        <div>
          <p className="muted dataset-answer-count">
            {props.t("dataset.rows")}: {visibleRows.length}/{props.snapshot.totalRowCount}
          </p>
          {props.onReveal ? <ManagedCollectionRevealAction activeVaultId={props.activeVaultId} datasetId={props.snapshot.datasetId}
            revisionId={props.snapshot.revisionId} tableId={props.snapshot.tableId} onReveal={props.onReveal} t={props.t} /> : null}
          {props.snapshot.canAppendDefaultRow ? (
            <button
              ref={appendTriggerRef}
              type="button"
              className="settings-button"
              disabled={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
              onClick={() => void appendDefaultRow()}
            >
              {props.t(busy && appendActiveRef.current !== null ? "collection.addingRow" : "collection.addRow")}
            </button>
          ) : null}
          {props.snapshot.canAddColumn && !columnDraft ? (
            <button
              ref={columnTriggerRef}
              type="button"
              className="settings-button"
              disabled={busy || columnActionsBusy || viewControlsBusy || edit !== null || appendActiveRef.current !== null}
              onClick={() => {
                if (busy || columnActionsActiveRef.current || viewControlsActiveRef.current || edit || appendActiveRef.current !== null || columnActiveRef.current !== null) return;
                setNotice(null);
                setColumnDraft({
                  expectedRevisionId: props.snapshot.revisionId,
                  label: "",
                  logicalType: "string"
                });
              }}
            >
              <PigeIcon name="attach" size={14} />
              {props.t("collection.addField")}
            </button>
          ) : null}
        </div>
      </header>
      <AnalyticalSnapshotPanel
        activeVaultId={props.activeVaultId}
        snapshot={props.snapshot}
        blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
        t={props.t}
      />
      <ManagedCollectionRevisionHistory activeVaultId={props.activeVaultId} snapshot={props.snapshot} blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null} onAdoptSnapshot={props.onAdoptSnapshot} t={props.t} />
      <ManagedCollectionViewControls activeVaultId={props.activeVaultId} snapshot={props.snapshot}
        blocked={busy || columnActionsBusy || edit !== null || columnDraft !== null}
        onOpenView={props.onOpenView} onCreateView={props.onCreateView} onUpdateView={props.onUpdateView}
        onRenameView={props.onRenameView} onTrashView={props.onTrashView}
        onAdoptSnapshot={props.onAdoptSnapshot}
        onBusyChange={(active) => { viewControlsActiveRef.current = active; setViewControlsBusy(active); }}
        t={props.t}
      />
      <ManagedCollectionFormulaColumnDialog activeVaultId={props.activeVaultId} snapshot={props.snapshot}
        blocked={busy || viewControlsBusy || relationActive || lookupActive || rollupActive || edit !== null || columnDraft !== null}
        requestedEdit={formulaEditRequest}
        onEditRequestHandled={() => setFormulaEditRequest(null)}
        onAdoptSnapshot={props.onAdoptSnapshot}
        onActiveChange={(active) => {
          formulaActiveRef.current = active;
          setFormulaActive(active);
          columnActionsActiveRef.current = active || relationActiveRef.current || lookupActiveRef.current || rollupActiveRef.current;
          setColumnActionsBusy(active || relationActiveRef.current || lookupActiveRef.current || rollupActiveRef.current);
        }}
        onFocusColumn={setColumnFocusRequest}
        t={props.t}
      />
      <ManagedCollectionRelationDialog activeVaultId={props.activeVaultId} snapshot={props.snapshot}
        blocked={busy || viewControlsBusy || formulaActive || lookupActive || rollupActive || edit !== null || columnDraft !== null}
        requestedEdit={relationEditRequest}
        onEditRequestHandled={() => setRelationEditRequest(null)}
        onAdoptSnapshot={props.onAdoptSnapshot}
        onActiveChange={(active) => {
          relationActiveRef.current = active;
          setRelationActive(active);
          columnActionsActiveRef.current = active || formulaActiveRef.current || lookupActiveRef.current || rollupActiveRef.current;
          setColumnActionsBusy(active || formulaActiveRef.current || lookupActiveRef.current || rollupActiveRef.current);
        }}
        onFocusCell={(rowId, columnId) => setCellFocusRequest({ rowId, columnId })}
        onFocusColumn={setColumnFocusRequest}
        t={props.t}
      />
      <ManagedCollectionLookupDialog activeVaultId={props.activeVaultId} snapshot={props.snapshot}
        blocked={busy || viewControlsBusy || formulaActive || relationActive || rollupActive || edit !== null || columnDraft !== null}
        onAdoptSnapshot={props.onAdoptSnapshot}
        onActiveChange={(active) => {
          lookupActiveRef.current = active;
          setLookupActive(active);
          columnActionsActiveRef.current = active || formulaActiveRef.current || relationActiveRef.current || rollupActiveRef.current;
          setColumnActionsBusy(active || formulaActiveRef.current || relationActiveRef.current || rollupActiveRef.current);
        }}
        onFocusColumn={setColumnFocusRequest}
        t={props.t}
      />
      <ManagedCollectionRollupDialog activeVaultId={props.activeVaultId} snapshot={props.snapshot}
        blocked={busy || viewControlsBusy || formulaActive || relationActive || lookupActive || edit !== null || columnDraft !== null}
        onAdoptSnapshot={props.onAdoptSnapshot} onActiveChange={(active) => {
          rollupActiveRef.current = active; setRollupActive(active);
          columnActionsActiveRef.current = active || formulaActiveRef.current || relationActiveRef.current || lookupActiveRef.current;
          setColumnActionsBusy(active || formulaActiveRef.current || relationActiveRef.current || lookupActiveRef.current);
        }} onFocusColumn={setColumnFocusRequest} t={props.t} />
      {columnDraft ? (
        <form
          className="settings-card settings-row tall"
          aria-label={props.t("collection.addField")}
          onSubmit={(event) => {
            event.preventDefault();
            void addNullableColumn();
          }}
        >
          <div className="settings-row-copy">
            <label htmlFor="collection-new-field-name"><strong>{props.t("collection.fieldName")}</strong></label>
            <input
              ref={columnLabelRef}
              id="collection-new-field-name"
              className="settings-input"
              value={columnDraft.label}
              disabled={busy}
              maxLength={120}
              onChange={(event) => {
                setColumnDraft((current) => current ? { ...current, label: event.target.value } : current);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelColumnDraft();
                }
              }}
            />
          </div>
          <div className="settings-row-copy">
            <label htmlFor="collection-new-field-type"><strong>{props.t("collection.fieldType")}</strong></label>
            <select
              id="collection-new-field-type"
              className="settings-input"
              value={columnDraft.logicalType}
              disabled={busy}
              onChange={(event) => {
                setColumnDraft((current) => current ? {
                  ...current,
                  logicalType: event.target.value as CollectionAddNullableColumnRequest["logicalType"]
                } : current);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelColumnDraft();
                }
              }}
            >
              {COLLECTION_EDITABLE_TYPES.map((logicalType) => (
                <option value={logicalType} key={logicalType}>{props.t(`collection.type.${logicalType}`)}</option>
              ))}
            </select>
          </div>
          <div className="settings-row-control">
            <button type="submit" className="settings-button primary" disabled={busy || columnDraft.label.trim().length === 0}>
              {props.t(busy && columnActiveRef.current !== null ? "collection.addingField" : "collection.save")}
            </button>
            <button type="button" className="settings-button" disabled={busy} onClick={cancelColumnDraft}>
              {props.t("collection.cancel")}
            </button>
          </div>
        </form>
      ) : null}
      {notice ? (
        <div className={`settings-inline-status ${notice.kind === "saved" || notice.kind === "row_added" || notice.kind === "column_added" || notice.kind === "row_trashed" || notice.kind === "column_renamed" || notice.kind === "column_trashed" ? "success" : "error"}`} role="status" aria-live="polite">
          <span>{props.t(`collection.${notice.kind}`)}</span>
          {notice.kind === "stale" ? (
            <button type="button" className="settings-button" disabled={busy} onClick={() => void reloadAfterStale()}>
              {props.t("collection.reload")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div ref={tableScrollRef} className="dataset-table-scroll" tabIndex={0} aria-label={props.t("collection.table")}>
        <table className="dataset-table">
          <caption>{props.snapshot.tableName}</caption>
          <thead>
            <ManagedCollectionColumnActions
              activeVaultId={props.activeVaultId}
              snapshot={props.snapshot}
              blocked={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
              hasRowActions={hasTrashActions}
              requestedFocusColumnId={columnFocusRequest}
              onFocusHandled={() => setColumnFocusRequest(null)}
              onRenameColumn={props.onRenameColumn}
              onTrashColumn={props.onTrashColumn}
              onEditFormulaColumn={(columnId) => setFormulaEditRequest({ columnId, ownerKey, revisionId: props.snapshot.revisionId })}
              onEditRelationColumn={(columnId) => setRelationEditRequest({ kind: "definition", columnId, ownerKey, revisionId: props.snapshot.revisionId })}
              onAdoptSnapshot={props.onAdoptSnapshot}
              onBusyChange={(active) => {
                columnActionsActiveRef.current = active;
                setColumnActionsBusy(active);
              }}
              onNotice={(kind) => setNotice(kind ? { kind } : null)}
              onFallbackFocus={() => panelRef.current?.focus()}
              t={props.t}
            />
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={row.rowId}
                ref={(element) => {
                  if (element) rowRefs.current.set(row.rowId, element);
                  else rowRefs.current.delete(row.rowId);
                }}
                tabIndex={-1}
                aria-label={`${props.t("collection.row")} ${rowIndex + 1}`}
                data-collection-row-id={row.rowId}
              >
                {props.snapshot.columns.map((column) => {
                  const cell = row.cells.find((candidate) => candidate.columnId === column.columnId);
                  if (!cell) return <td key={column.columnId}>-</td>;
                  const cellValue = cell.value;
                  const identity = { rowId: row.rowId, columnId: column.columnId };
                  const editing = edit?.rowId === row.rowId && edit.columnId === column.columnId;
                  return (
                    <td key={column.columnId}>
                      {editing && edit ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void submitEdit();
                          }}
                        >
                          <ManagedCollectionScalarCellEditor
                            inputRef={editorRef}
                            draft={edit.draft}
                            logicalType={edit.logicalType}
                            disabled={busy}
                            label={`${props.t("collection.editValue")}: ${column.label}, ${props.t("collection.row")} ${rowIndex + 1}`}
                            onChange={(draft) => {
                              setEdit((current) => current ? { ...current, draft } : current);
                              setNotice(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                stopEditing(true);
                              }
                            }}
                          />
                          <button type="submit" className="settings-button" disabled={busy}>
                            {props.t(busy ? "collection.saving" : "collection.save")}
                          </button>
                          <button type="button" className="ghost" disabled={busy} onClick={() => stopEditing(true)}>
                            {props.t("collection.cancel")}
                          </button>
                        </form>
                      ) : column.relation && column.canEditRelation && typeof cellValue === "object" && cellValue?.kind === "relation" ? (
                        <div className="managed-collection-relation-actions">
                          <button
                            type="button"
                            className="ghost"
                            disabled={busy || columnActionsBusy || viewControlsBusy || columnDraft !== null || relatedRecordBusy}
                            ref={(element) => {
                              if (element) editTriggerRefs.current.set(cellKey(identity), element);
                              else editTriggerRefs.current.delete(cellKey(identity));
                            }}
                            aria-label={`${props.t("collection.editRelation")}: ${column.label}, ${props.t("collection.row")} ${rowIndex + 1}`}
                            onClick={() => {
                              if (busy || columnActionsActiveRef.current || viewControlsActiveRef.current || columnDraft || appendActiveRef.current !== null || columnActiveRef.current !== null || trashActiveRef.current || relatedActiveRef.current !== null) return;
                              setNotice(null);
                              setRelationEditRequest({ kind: "cell", ...identity, ownerKey, revisionId: props.snapshot.revisionId });
                            }}
                          >
                            {formatCollectionCellValue(cellValue) || props.t("collection.relationEmpty")}
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            disabled={busy || columnActionsBusy || viewControlsBusy || columnDraft !== null || relatedRecordBusy}
                            ref={(element) => {
                              if (element) relatedRecordTriggerRefs.current.set(cellKey(identity), element);
                              else relatedRecordTriggerRefs.current.delete(cellKey(identity));
                            }}
                            aria-label={`${props.t("collection.openRelatedRecords")}: ${column.label}, ${props.t("collection.row")} ${rowIndex + 1}`}
                            onClick={() => void openRelatedRecords(identity)}
                          >
                            {relatedRecordBusy ? props.t("collection.openingRelatedRecord") : props.t("collection.openRelatedRecords")}
                          </button>
                        </div>
                      ) : cell.editable && isCollectionScalarValue(cellValue) ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy || columnActionsBusy || viewControlsBusy || columnDraft !== null}
                          ref={(element) => {
                            if (element) editTriggerRefs.current.set(cellKey(identity), element);
                            else editTriggerRefs.current.delete(cellKey(identity));
                          }}
                          aria-label={`${props.t("collection.edit")}: ${column.label}, ${props.t("collection.row")} ${rowIndex + 1}`}
                          onClick={() => {
                            if (busy || columnActionsActiveRef.current || viewControlsActiveRef.current || columnDraft || appendActiveRef.current !== null || columnActiveRef.current !== null || trashActiveRef.current) return;
                            setNotice(null);
                            setEdit({
                              ...identity,
                              expectedRevisionId: props.snapshot.revisionId,
                              logicalType: column.logicalType,
                              originalValue: cellValue,
                              draft: formatCollectionCellValue(cellValue)
                            });
                          }}
                        >
                          {formatCollectionCellValue(cellValue)}
                        </button>
                      ) : (
                        <span title={props.t("collection.readOnly")}>{formatCollectionCellValue(cellValue)}</span>
                      )}
                    </td>
                  );
                })}
                {hasTrashActions ? (
                  <td>
                    {row.canTrash ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
                        ref={(element) => {
                          if (element) trashTriggerRefs.current.set(row.rowId, element);
                          else trashTriggerRefs.current.delete(row.rowId);
                        }}
                        aria-label={`${props.t("collection.trashRow")}: ${props.t("collection.row")} ${rowIndex + 1}`}
                        onClick={() => void trashRow(row.rowId, rowIndex)}
                      >
                        {props.t(busy && trashActiveRef.current?.rowId === row.rowId
                          ? "collection.trashingRow"
                          : "collection.trashRow")}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {relatedRecordBusy || relatedRecordResult ? <ManagedCollectionRelatedRecordPanel result={relatedRecordResult} loading={relatedRecordBusy} onClose={closeRelatedRecords} t={props.t} /> : null}
      {visibleRows.length === 0 ? <p className="muted">{props.t("collection.empty")}</p> : null}
      {rowsLoadFailed ? <p className="muted retrieval-warning" role="status">{props.t("collection.rowsLoadFailed")}</p> : null}
      {nextRowCursor ? (
        <button
          ref={loadMoreTriggerRef}
          type="button"
          className="settings-button"
          disabled={rowsLoading || busy || columnActionsBusy || viewControlsBusy || edit !== null || columnDraft !== null}
          onClick={() => void loadMoreRows()}
        >
          {props.t(rowsLoading ? "collection.rowsLoading" : "collection.loadMoreRows")}
        </button>
      ) : props.snapshot.truncated && visibleRows.length < props.snapshot.totalRowCount ? (
        <p className="muted retrieval-warning">{props.t("dataset.truncated")}</p>
      ) : null}
    </section>
  );
}

function collectionPaginationIdentity(activeVaultId: string, snapshot: CollectionSnapshot): string {
  const activeView = snapshot.views.find(({ viewId }) => viewId === snapshot.activeViewId);
  return JSON.stringify([
    activeVaultId,
    snapshot.datasetId,
    snapshot.revisionId,
    snapshot.tableId,
    snapshot.activeViewId ?? null,
    activeView?.filter ?? null,
    activeView?.sort ?? null
  ]);
}

function collectionRelatedRecordIdentityMatches(
  request: CollectionOpenRelatedRecordsRequest,
  result: CollectionOpenRelatedRecordsResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.sourceTableId === request.sourceTableId &&
    result.sourceColumnId === request.sourceColumnId &&
    result.sourceRowId === request.sourceRowId;
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function cellKey(identity: CellIdentity): string {
  return `${identity.rowId}:${identity.columnId}`;
}

function collectionEditIdentityMatches(
  request: CollectionCellEditRequest,
  result: CollectionCellEditResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId &&
    result.rowId === request.rowId &&
    result.columnId === request.columnId;
}

function collectionIdentityMatches(
  request: { readonly requestId: string; readonly activeVaultId: string; readonly datasetId: string; readonly tableId: string },
  result: { readonly requestId: string; readonly activeVaultId: string; readonly datasetId: string; readonly tableId: string }
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId;
}
