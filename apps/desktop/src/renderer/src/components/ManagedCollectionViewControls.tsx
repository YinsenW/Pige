import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionCreateViewRequest,
  CollectionCreateViewResult,
  CollectionScalarValue,
  CollectionSnapshot,
  DatasetLogicalType
} from "@pige/schemas";

type ViewDraft = {
  readonly expectedRevisionId: string;
  readonly name: string;
  readonly filterColumnId: string;
  readonly filterOperator: "eq" | "is_null";
  readonly filterValue: string;
  readonly sortColumnId: string;
  readonly sortDirection: "asc" | "desc";
};

type ViewNotice = "created" | "stale" | "duplicate" | "ineligible" | "not_found" | "failed" | "open_failed";

export function ManagedCollectionViewControls(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onOpenView: (viewId?: string) => Promise<CollectionSnapshot | null>;
  readonly onCreateView: (request: CollectionCreateViewRequest) => Promise<CollectionCreateViewResult>;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ViewDraft | null>(null);
  const [notice, setNotice] = useState<ViewNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  const actionActiveRef = useRef<number | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerKeyRef = useRef(ownerKey);
  const revisionRef = useRef(props.snapshot.revisionId);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectFocusRef = useRef(false);
  const pendingDraftFocusRef = useRef(false);
  ownerKeyRef.current = ownerKey;
  revisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    actionActiveRef.current = null;
    pendingSelectFocusRef.current = false;
    pendingDraftFocusRef.current = false;
    setDraft(null);
    setNotice(null);
    setBusy(false);
    props.onBusyChange(false);
  }, [ownerKey]);

  useLayoutEffect(() => {
    if (busy) return;
    if (pendingDraftFocusRef.current && draft) {
      pendingDraftFocusRef.current = false;
      nameRef.current?.focus();
      return;
    }
    if (!pendingSelectFocusRef.current) return;
    pendingSelectFocusRef.current = false;
    selectRef.current?.focus();
  }, [busy, draft, notice, props.snapshot.activeViewId, props.snapshot.revisionId]);

  const beginAction = (): number | null => {
    if (props.blocked || actionActiveRef.current !== null) return null;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    actionActiveRef.current = sequence;
    setBusy(true);
    props.onBusyChange(true);
    setNotice(null);
    return sequence;
  };

  const finishAction = (sequence: number, expectedOwnerKey: string): void => {
    if (actionActiveRef.current === sequence) actionActiveRef.current = null;
    if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey) return;
    setBusy(false);
    props.onBusyChange(false);
  };

  const openView = async (viewId?: string): Promise<void> => {
    if (viewId === props.snapshot.activeViewId || (viewId === undefined && props.snapshot.activeViewId === undefined)) return;
    const sequence = beginAction();
    if (sequence === null) return;
    const expectedOwnerKey = ownerKey;
    try {
      const snapshot = await props.onOpenView(viewId);
      if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey) return;
      if (!snapshot || snapshot.datasetId !== props.snapshot.datasetId || snapshot.tableId !== props.snapshot.tableId ||
          snapshot.activeViewId !== viewId) {
        setNotice("open_failed");
        pendingSelectFocusRef.current = true;
        return;
      }
      setNotice(null);
      pendingSelectFocusRef.current = true;
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setNotice("open_failed");
        pendingSelectFocusRef.current = true;
      }
    } finally {
      finishAction(sequence, expectedOwnerKey);
    }
  };

  const createView = async (): Promise<void> => {
    if (!draft) return;
    const filterColumn = props.snapshot.columns.find(({ columnId }) => columnId === draft.filterColumnId);
    const sortColumn = props.snapshot.columns.find(({ columnId }) => columnId === draft.sortColumnId);
    const value = draft.filterOperator === "eq" && filterColumn
      ? parseFilterValue(draft.filterValue, filterColumn.logicalType)
      : undefined;
    if (!filterColumn || !sortColumn || draft.name.trim().length === 0 ||
        (draft.filterOperator === "eq" && value === undefined)) return;
    const sequence = beginAction();
    if (sequence === null) return;
    const request: CollectionCreateViewRequest = {
      apiVersion: 1,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: draft.expectedRevisionId,
      name: draft.name.trim(),
      filter: draft.filterOperator === "is_null"
        ? { operator: "is_null", columnId: filterColumn.columnId }
        : { operator: "eq", columnId: filterColumn.columnId, value: value as Exclude<CollectionScalarValue, null> },
      sort: { columnId: sortColumn.columnId, direction: draft.sortDirection }
    };
    const expectedOwnerKey = ownerKey;
    try {
      const result = await props.onCreateView(request);
      if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
          revisionRef.current !== request.expectedRevisionId || !viewIdentityMatches(request, result)) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setDraft(null);
        setNotice("created");
        pendingSelectFocusRef.current = true;
        return;
      }
      if ("snapshot" in result) {
        setDraft((current) => current ? { ...current, expectedRevisionId: result.snapshot.revisionId } : current);
      }
      setNotice(result.status);
      pendingDraftFocusRef.current = true;
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setNotice("failed");
        pendingDraftFocusRef.current = true;
      }
    } finally {
      finishAction(sequence, expectedOwnerKey);
    }
  };

  const filterColumn = draft
    ? props.snapshot.columns.find(({ columnId }) => columnId === draft.filterColumnId)
    : undefined;
  const equalitySupported = filterColumn ? supportsEquality(filterColumn.logicalType) : false;
  const equalityValue = draft && filterColumn && draft.filterOperator === "eq"
    ? parseFilterValue(draft.filterValue, filterColumn.logicalType)
    : undefined;
  const createDisabled = !draft || draft.name.trim().length === 0 || !filterColumn ||
    !props.snapshot.columns.some(({ columnId }) => columnId === draft.sortColumnId) ||
    (draft.filterOperator === "eq" && equalityValue === undefined);

  return (
    <section className="settings-card settings-row tall" aria-label={props.t("collection.views")}>
      <div className="settings-row-copy">
        <label htmlFor="collection-view-select"><strong>{props.t("collection.view")}</strong></label>
        <select
          ref={selectRef}
          id="collection-view-select"
          className="settings-input"
          value={props.snapshot.activeViewId ?? ""}
          disabled={props.blocked || busy}
          onChange={(event) => void openView(event.target.value || undefined)}
        >
          <option value="">{props.t("collection.allRows")}</option>
          {props.snapshot.views.map((view) => <option key={view.viewId} value={view.viewId}>{view.name}</option>)}
        </select>
      </div>
      {!draft ? (
        <div className="settings-row-control">
          <button
            type="button"
            className="settings-button"
            disabled={props.blocked || busy}
            onClick={() => {
              if (props.blocked || actionActiveRef.current !== null) return;
              const firstColumn = props.snapshot.columns[0];
              if (!firstColumn) return;
              setNotice(null);
              setDraft({
                expectedRevisionId: props.snapshot.revisionId,
                name: "",
                filterColumnId: firstColumn.columnId,
                filterOperator: supportsEquality(firstColumn.logicalType) ? "eq" : "is_null",
                filterValue: "",
                sortColumnId: firstColumn.columnId,
                sortDirection: "asc"
              });
              pendingDraftFocusRef.current = true;
            }}
          >
            {props.t("collection.createView")}
          </button>
        </div>
      ) : (
        <form
          aria-label={props.t("collection.createView")}
          onSubmit={(event) => { event.preventDefault(); void createView(); }}
        >
          <label htmlFor="collection-view-name">{props.t("collection.viewName")}</label>
          <input
            ref={nameRef}
            id="collection-view-name"
            className="settings-input"
            value={draft.name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setNotice(null); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(null);
                setNotice(null);
                pendingSelectFocusRef.current = true;
              }
            }}
          />
          <label htmlFor="collection-view-filter-column">{props.t("collection.filterField")}</label>
          <select
            id="collection-view-filter-column"
            className="settings-input"
            value={draft.filterColumnId}
            disabled={busy}
            onChange={(event) => {
              const nextColumn = props.snapshot.columns.find(({ columnId }) => columnId === event.target.value);
              setDraft({
                ...draft,
                filterColumnId: event.target.value,
                filterOperator: nextColumn && supportsEquality(nextColumn.logicalType) ? draft.filterOperator : "is_null"
              });
              setNotice(null);
            }}
          >
            {props.snapshot.columns.map((column) => <option key={column.columnId} value={column.columnId}>{column.label}</option>)}
          </select>
          <label htmlFor="collection-view-filter-operator">{props.t("collection.filterOperator")}</label>
          <select
            id="collection-view-filter-operator"
            className="settings-input"
            value={draft.filterOperator}
            disabled={busy}
            onChange={(event) => {
              setDraft({ ...draft, filterOperator: event.target.value as ViewDraft["filterOperator"] });
              setNotice(null);
            }}
          >
            {equalitySupported ? <option value="eq">{props.t("collection.filterEquals")}</option> : null}
            <option value="is_null">{props.t("collection.filterIsEmpty")}</option>
          </select>
          {draft.filterOperator === "eq" && filterColumn ? (
            <FilterValueEditor
              value={draft.filterValue}
              logicalType={filterColumn.logicalType}
              disabled={busy}
              label={props.t("collection.filterValue")}
              falseLabel={props.t("collection.filterFalse")}
              trueLabel={props.t("collection.filterTrue")}
              onChange={(filterValue) => { setDraft({ ...draft, filterValue }); setNotice(null); }}
            />
          ) : null}
          <label htmlFor="collection-view-sort-column">{props.t("collection.sortField")}</label>
          <select
            id="collection-view-sort-column"
            className="settings-input"
            value={draft.sortColumnId}
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, sortColumnId: event.target.value }); setNotice(null); }}
          >
            {props.snapshot.columns.map((column) => <option key={column.columnId} value={column.columnId}>{column.label}</option>)}
          </select>
          <label htmlFor="collection-view-sort-direction">{props.t("collection.sortDirection")}</label>
          <select
            id="collection-view-sort-direction"
            className="settings-input"
            value={draft.sortDirection}
            disabled={busy}
            onChange={(event) => {
              setDraft({ ...draft, sortDirection: event.target.value as ViewDraft["sortDirection"] });
              setNotice(null);
            }}
          >
            <option value="asc">{props.t("collection.ascending")}</option>
            <option value="desc">{props.t("collection.descending")}</option>
          </select>
          <button type="submit" className="settings-button primary" disabled={busy || createDisabled}>
            {props.t(busy ? "collection.creatingView" : "collection.save")}
          </button>
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => { setDraft(null); setNotice(null); pendingSelectFocusRef.current = true; }}
          >
            {props.t("collection.cancel")}
          </button>
        </form>
      )}
      {notice ? (
        <div className={`settings-inline-status ${notice === "created" ? "success" : "error"}`} role="status" aria-live="polite">
          {props.t(`collection.view_${notice}`)}
        </div>
      ) : null}
    </section>
  );
}

function FilterValueEditor(props: {
  readonly value: string;
  readonly logicalType: DatasetLogicalType;
  readonly disabled: boolean;
  readonly label: string;
  readonly falseLabel: string;
  readonly trueLabel: string;
  readonly onChange: (value: string) => void;
}): React.JSX.Element {
  if (props.logicalType === "boolean") {
    return (
      <>
        <label htmlFor="collection-view-filter-value">{props.label}</label>
        <select
          id="collection-view-filter-value"
          className="settings-input"
          value={props.value || "false"}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value)}
        >
          <option value="false">{props.falseLabel}</option>
          <option value="true">{props.trueLabel}</option>
        </select>
      </>
    );
  }
  return (
    <>
      <label htmlFor="collection-view-filter-value">{props.label}</label>
      <input
        id="collection-view-filter-value"
        className="settings-input"
        type={props.logicalType === "integer" || props.logicalType === "number"
          ? "number"
          : props.logicalType === "date"
            ? "date"
            : props.logicalType === "datetime"
              ? "datetime-local"
              : "text"}
        step={props.logicalType === "integer" ? "1" : props.logicalType === "number" ? "any" : undefined}
        value={props.value}
        maxLength={4096}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </>
  );
}

function supportsEquality(logicalType: DatasetLogicalType): boolean {
  return logicalType !== "binary" && logicalType !== "unknown";
}

function parseFilterValue(value: string, logicalType: DatasetLogicalType): Exclude<CollectionScalarValue, null> | undefined {
  if (logicalType === "boolean") return value === "true" ? true : value === "false" || value === "" ? false : undefined;
  if (logicalType === "integer" || logicalType === "number") {
    if (value.trim().length === 0) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && (logicalType !== "integer" || Number.isInteger(parsed)) ? parsed : undefined;
  }
  return supportsEquality(logicalType) ? value : undefined;
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function viewIdentityMatches(
  request: CollectionCreateViewRequest,
  result: CollectionCreateViewResult
): boolean {
  return result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId &&
    result.tableId === request.tableId;
}
