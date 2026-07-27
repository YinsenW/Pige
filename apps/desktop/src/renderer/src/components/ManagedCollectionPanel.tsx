import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type {
  CollectionAddNullableColumnRequest,
  CollectionAddNullableColumnResult,
  CollectionAppendDefaultRowRequest,
  CollectionAppendDefaultRowResult,
  CollectionCellEditRequest,
  CollectionCellEditResult,
  CollectionRenameColumnRequest,
  CollectionRenameColumnResult,
  CollectionScalarValue,
  CollectionSnapshot,
  CollectionTrashRowRequest,
  CollectionTrashRowResult,
  DatasetLogicalType
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

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

type ColumnRenameDraft = {
  readonly columnId: string;
  readonly expectedRevisionId: string;
  readonly originalLabel: string;
  readonly label: string;
};

const COLLECTION_EDITABLE_TYPES = ["string", "integer", "number", "boolean", "date", "datetime"] as const;

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
  | { readonly kind: "column_renamed" }
  | { readonly kind: "rename_stale" }
  | { readonly kind: "rename_duplicate" }
  | { readonly kind: "rename_ineligible" }
  | { readonly kind: "rename_not_found" }
  | { readonly kind: "rename_failed" }
  | { readonly kind: "stale" }
  | { readonly kind: "invalid" }
  | { readonly kind: "not_editable" }
  | { readonly kind: "failed" };

export function ManagedCollectionPanel(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly onClose: () => void;
  readonly onAppendDefaultRow: (
    request: CollectionAppendDefaultRowRequest
  ) => Promise<CollectionAppendDefaultRowResult>;
  readonly onTrashRow: (request: CollectionTrashRowRequest) => Promise<CollectionTrashRowResult>;
  readonly onAddNullableColumn: (
    request: CollectionAddNullableColumnRequest
  ) => Promise<CollectionAddNullableColumnResult>;
  readonly onRenameColumn: (
    request: CollectionRenameColumnRequest
  ) => Promise<CollectionRenameColumnResult>;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onEditCell: (request: CollectionCellEditRequest) => Promise<CollectionCellEditResult>;
  readonly onReload: () => Promise<CollectionSnapshot | null>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [columnDraft, setColumnDraft] = useState<ColumnDraft | null>(null);
  const [renameDraft, setRenameDraft] = useState<ColumnRenameDraft | null>(null);
  const [notice, setNotice] = useState<EditNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  const appendActiveRef = useRef<number | null>(null);
  const appendTriggerRef = useRef<HTMLButtonElement | null>(null);
  const trashActiveRef = useRef<{ readonly sequence: number; readonly rowId: string } | null>(null);
  const trashTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const columnActiveRef = useRef<number | null>(null);
  const columnTriggerRef = useRef<HTMLButtonElement | null>(null);
  const columnLabelRef = useRef<HTMLInputElement | null>(null);
  const columnHeaderRefs = useRef(new Map<string, HTMLTableCellElement>());
  const renameActiveRef = useRef<{ readonly sequence: number; readonly columnId: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRenameEditorFocusRef = useRef(false);
  const editTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFocusRef = useRef<CellIdentity | null>(null);
  const pendingAppendFocusRef = useRef(false);
  const pendingRowFocusRef = useRef<string | null>(null);
  const pendingTrashFocusRef = useRef<{
    readonly rowId: string | null;
    readonly preferAction: boolean;
  } | null>(null);
  const pendingColumnFocusRef = useRef<string | null>(null);
  const pendingColumnTriggerFocusRef = useRef(false);
  const pendingColumnEditorFocusRef = useRef(false);
  const editorRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerKeyRef = useRef(ownerKey);
  const snapshotRevisionRef = useRef(props.snapshot.revisionId);
  ownerKeyRef.current = ownerKey;
  snapshotRevisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    appendActiveRef.current = null;
    trashActiveRef.current = null;
    columnActiveRef.current = null;
    renameActiveRef.current = null;
    pendingFocusRef.current = null;
    pendingAppendFocusRef.current = false;
    pendingRowFocusRef.current = null;
    pendingTrashFocusRef.current = null;
    pendingColumnFocusRef.current = null;
    pendingColumnTriggerFocusRef.current = false;
    pendingColumnEditorFocusRef.current = false;
    pendingRenameEditorFocusRef.current = false;
    setEdit(null);
    setColumnDraft(null);
    setRenameDraft(null);
    setNotice(null);
    setBusy(false);
  }, [ownerKey]);

  useEffect(() => {
    if (edit) editorRef.current?.focus();
  }, [edit?.rowId, edit?.columnId]);

  useEffect(() => {
    if (columnDraft && !busy) columnLabelRef.current?.focus();
  }, [columnDraft?.expectedRevisionId]);

  useEffect(() => {
    if (renameDraft && !busy) renameInputRef.current?.focus();
  }, [renameDraft?.columnId, renameDraft?.expectedRevisionId]);

  useLayoutEffect(() => {
    if (edit || !pendingFocusRef.current) return;
    const button = editTriggerRefs.current.get(cellKey(pendingFocusRef.current));
    if (!button) return;
    pendingFocusRef.current = null;
    button.focus();
  }, [edit]);

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
    if (pendingColumnFocusRef.current) {
      const header = columnHeaderRefs.current.get(pendingColumnFocusRef.current);
      if (header) {
        pendingColumnFocusRef.current = null;
        header.focus();
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
  }, [busy, notice, props.snapshot.revisionId]);

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

  useLayoutEffect(() => {
    if (busy || !pendingRenameEditorFocusRef.current || !renameDraft) return;
    pendingRenameEditorFocusRef.current = false;
    renameInputRef.current?.focus();
  }, [busy, notice, renameDraft, props.snapshot.revisionId]);

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
    if (!edit || busy || renameDraft) return;
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
    if (!props.snapshot.canAppendDefaultRow || busy || edit || columnDraft || renameDraft || appendActiveRef.current !== null || trashActiveRef.current) return;
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
    const row = props.snapshot.rows.find((candidate) => candidate.rowId === rowId);
    if (!row?.canTrash || busy || edit || columnDraft || renameDraft || trashActiveRef.current) return;
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

  const hasTrashActions = props.snapshot.rows.some((row) => row.canTrash);

  const addNullableColumn = async (): Promise<void> => {
    if (!columnDraft || busy || renameDraft || columnActiveRef.current !== null) return;
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
        pendingColumnFocusRef.current = result.columnId;
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

  const renameColumn = async (): Promise<void> => {
    if (!renameDraft || busy || renameActiveRef.current) return;
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === renameDraft.columnId);
    const label = renameDraft.label.trim();
    if (!column?.canRename || label.length === 0 || label === renameDraft.originalLabel) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    renameActiveRef.current = { sequence, columnId: renameDraft.columnId };
    const request: CollectionRenameColumnRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: renameDraft.expectedRevisionId,
      columnId: renameDraft.columnId,
      label
    };
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = await props.onRenameColumn(request);
      if (
        sequence !== requestSequence.current ||
        ownerKeyRef.current !== expectedOwnerKey ||
        snapshotRevisionRef.current !== request.expectedRevisionId ||
        (!collectionIdentityMatches(request, result) || result.columnId !== request.columnId)
      ) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        pendingColumnFocusRef.current = result.columnId;
        setRenameDraft(null);
        setNotice({ kind: "column_renamed" });
        return;
      }
      pendingRenameEditorFocusRef.current = true;
      if ("snapshot" in result) {
        const currentColumn = result.snapshot.columns.find((candidate) => candidate.columnId === result.columnId);
        setRenameDraft((current) => current ? {
          ...current,
          expectedRevisionId: result.snapshot.revisionId,
          originalLabel: currentColumn?.label ?? current.originalLabel
        } : current);
      }
      setNotice({
        kind: result.status === "stale"
          ? "rename_stale"
          : result.status === "duplicate"
            ? "rename_duplicate"
            : result.status === "ineligible"
              ? "rename_ineligible"
              : result.status === "not_found"
                ? "rename_not_found"
                : "rename_failed"
      });
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        pendingRenameEditorFocusRef.current = true;
        setNotice({ kind: "rename_failed" });
      }
    } finally {
      if (renameActiveRef.current?.sequence === sequence) renameActiveRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const cancelRename = (): void => {
    if (busy || !renameDraft) return;
    pendingColumnFocusRef.current = renameDraft.columnId;
    setRenameDraft(null);
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
          <p className="muted">{props.snapshot.tableName}</p>
        </div>
        <div>
          <p className="muted dataset-answer-count">
            {props.t("dataset.rows")}: {props.snapshot.returnedRowCount}/{props.snapshot.totalRowCount}
          </p>
          {props.snapshot.canAppendDefaultRow ? (
            <button
              ref={appendTriggerRef}
              type="button"
              className="settings-button"
              disabled={busy || edit !== null || columnDraft !== null || renameDraft !== null}
              onClick={() => void appendDefaultRow()}
            >
              {props.t(busy && appendActiveRef.current !== null ? "collection.addingRow" : "collection.addRow")}
            </button>
          ) : null}
          {props.snapshot.canAddColumn && !columnDraft && !renameDraft ? (
            <button
              ref={columnTriggerRef}
              type="button"
              className="settings-button"
              disabled={busy || edit !== null || appendActiveRef.current !== null}
              onClick={() => {
                if (busy || edit || appendActiveRef.current !== null || columnActiveRef.current !== null || renameActiveRef.current) return;
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
        <div className={`settings-inline-status ${notice.kind === "saved" || notice.kind === "row_added" || notice.kind === "column_added" || notice.kind === "row_trashed" || notice.kind === "column_renamed" ? "success" : "error"}`} role="status" aria-live="polite">
          <span>{props.t(`collection.${notice.kind}`)}</span>
          {notice.kind === "stale" ? (
            <button type="button" className="settings-button" disabled={busy} onClick={() => void reloadAfterStale()}>
              {props.t("collection.reload")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="dataset-table-scroll" tabIndex={0} aria-label={props.t("collection.table")}>
        <table className="dataset-table">
          <caption>{props.snapshot.tableName}</caption>
          <thead>
            <tr>{props.snapshot.columns.map((column) => (
              <th
                scope="col"
                key={column.columnId}
                ref={(element) => {
                  if (element) columnHeaderRefs.current.set(column.columnId, element);
                  else columnHeaderRefs.current.delete(column.columnId);
                }}
                tabIndex={-1}
                data-collection-column-id={column.columnId}
              >
                {renameDraft?.columnId === column.columnId ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameColumn();
                    }}
                  >
                    <input
                      ref={renameInputRef}
                      className="settings-input"
                      value={renameDraft.label}
                      maxLength={120}
                      disabled={busy}
                      aria-label={`${props.t("collection.fieldName")}: ${column.label}`}
                      onChange={(event) => {
                        setRenameDraft((current) => current ? { ...current, label: event.target.value } : current);
                        setNotice(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="settings-button"
                      disabled={busy || !column.canRename || renameDraft.label.trim().length === 0 || renameDraft.label.trim() === renameDraft.originalLabel}
                    >
                      {props.t(busy && renameActiveRef.current?.columnId === column.columnId
                        ? "collection.renamingField"
                        : "collection.save")}
                    </button>
                    <button type="button" className="ghost" disabled={busy} onClick={cancelRename}>
                      {props.t("collection.cancel")}
                    </button>
                  </form>
                ) : column.canRename && !renameDraft ? (
                  <button
                    type="button"
                    className="ghost"
                    aria-label={`${props.t("collection.renameField")}: ${column.label}`}
                    disabled={busy || edit !== null || columnDraft !== null}
                    onClick={() => {
                      if (busy || edit || columnDraft || appendActiveRef.current !== null || trashActiveRef.current || columnActiveRef.current !== null || renameActiveRef.current) return;
                      setNotice(null);
                      setRenameDraft({
                        columnId: column.columnId,
                        expectedRevisionId: props.snapshot.revisionId,
                        originalLabel: column.label,
                        label: column.label
                      });
                    }}
                  >
                    {column.label}
                  </button>
                ) : column.label}
              </th>
            ))}{hasTrashActions ? <th scope="col">{props.t("collection.actions")}</th> : null}</tr>
          </thead>
          <tbody>
            {props.snapshot.rows.map((row, rowIndex) => (
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
                          <CollectionValueEditor
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
                      ) : cell.editable ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy || columnDraft !== null || renameDraft !== null}
                          ref={(element) => {
                            if (element) editTriggerRefs.current.set(cellKey(identity), element);
                            else editTriggerRefs.current.delete(cellKey(identity));
                          }}
                          aria-label={`${props.t("collection.edit")}: ${column.label}, ${props.t("collection.row")} ${rowIndex + 1}`}
                          onClick={() => {
                            if (busy || columnDraft || renameDraft || appendActiveRef.current !== null || columnActiveRef.current !== null || trashActiveRef.current) return;
                            setNotice(null);
                            setEdit({
                              ...identity,
                              expectedRevisionId: props.snapshot.revisionId,
                              logicalType: column.logicalType,
                              originalValue: cell.value,
                              draft: formatCollectionScalar(cell.value)
                            });
                          }}
                        >
                          {formatCollectionScalar(cell.value)}
                        </button>
                      ) : (
                        <span title={props.t("collection.readOnly")}>{formatCollectionScalar(cell.value)}</span>
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
                        disabled={busy || edit !== null || columnDraft !== null || renameDraft !== null}
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
      {props.snapshot.rows.length === 0 ? <p className="muted">{props.t("collection.empty")}</p> : null}
      {props.snapshot.truncated ? <p className="muted retrieval-warning">{props.t("dataset.truncated")}</p> : null}
    </section>
  );
}

function CollectionValueEditor(props: {
  readonly inputRef: Ref<HTMLInputElement | HTMLSelectElement>;
  readonly draft: string;
  readonly logicalType: DatasetLogicalType;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (draft: string) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
}): React.JSX.Element {
  if (props.logicalType === "boolean") {
    return (
      <select
        ref={props.inputRef as Ref<HTMLSelectElement>}
        aria-label={props.label}
        value={props.draft}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
      >
        <option value="">-</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      ref={props.inputRef as Ref<HTMLInputElement>}
      type={props.logicalType === "date" ? "date" : props.logicalType === "datetime" ? "datetime-local" : "text"}
      inputMode={props.logicalType === "integer" || props.logicalType === "number" ? "decimal" : undefined}
      aria-label={props.label}
      value={props.draft}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={props.onKeyDown}
    />
  );
}

function parseCollectionScalar(
  draft: string,
  logicalType: DatasetLogicalType,
  originalValue: CollectionScalarValue
): CollectionScalarValue | undefined {
  if (draft === "" && originalValue === null) return null;
  if (logicalType === "boolean") {
    if (draft === "") return null;
    if (draft === "true") return true;
    if (draft === "false") return false;
    return undefined;
  }
  if (logicalType === "integer") {
    if (!/^-?\d+$/u.test(draft)) return undefined;
    const value = Number(draft);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (logicalType === "number") {
    if (draft.trim() === "") return undefined;
    const value = Number(draft);
    return Number.isFinite(value) ? value : undefined;
  }
  if (logicalType === "binary" || logicalType === "unknown") return undefined;
  return new TextEncoder().encode(draft).byteLength <= 4096 ? draft : undefined;
}

function formatCollectionScalar(value: CollectionScalarValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
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
