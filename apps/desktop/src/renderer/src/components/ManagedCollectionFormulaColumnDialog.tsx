import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionAddFormulaColumnRequest,
  CollectionAddFormulaColumnResult,
  CollectionSnapshot,
  CollectionUpdateFormulaColumnRequest,
  CollectionUpdateFormulaColumnResult,
  DatasetPigeFormulaExpression
} from "@pige/schemas";

type FormulaOperator = Extract<DatasetPigeFormulaExpression, { readonly kind: "binary" }>["operator"];
type FormulaDraft = {
  readonly mode: "add" | "edit";
  readonly columnId?: string;
  readonly expectedRevisionId: string;
  readonly label: string;
  readonly leftColumnId: string;
  readonly operator: FormulaOperator;
  readonly rightKind: "column" | "literal";
  readonly rightColumnId: string;
  readonly literal: string;
};
type FormulaNotice = "added" | "updated" | "stale" | "duplicate" | "limit" | "ineligible" |
  "not_found" | "failed" | "update_ineligible" | "update_no_change" | "update_not_found" | "update_failed";

export function ManagedCollectionFormulaColumnDialog(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly requestedEdit: {
    readonly columnId: string;
    readonly ownerKey: string;
    readonly revisionId: string;
  } | null;
  readonly onEditRequestHandled: () => void;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onActiveChange: (active: boolean) => void;
  readonly onFocusColumn: (columnId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<FormulaDraft | null>(null);
  const [notice, setNotice] = useState<FormulaNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  const activeRequestRef = useRef<number | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
  const ownerKeyRef = useRef(ownerKey);
  const revisionRef = useRef(props.snapshot.revisionId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const leftRef = useRef<HTMLSelectElement | null>(null);
  const pendingTriggerFocusRef = useRef(false);
  const pendingDraftFocusRef = useRef(false);
  ownerKeyRef.current = ownerKey;
  revisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    activeRequestRef.current = null;
    pendingTriggerFocusRef.current = false;
    pendingDraftFocusRef.current = false;
    setDraft(null);
    setNotice(null);
    setBusy(false);
    props.onActiveChange(false);
  }, [ownerKey]);

  useLayoutEffect(() => {
    if (busy) return;
    if (pendingDraftFocusRef.current && draft) {
      pendingDraftFocusRef.current = false;
      (draft.mode === "edit" ? leftRef.current : nameRef.current)?.focus();
      return;
    }
    if (!pendingTriggerFocusRef.current || draft) return;
    pendingTriggerFocusRef.current = false;
    triggerRef.current?.focus();
  }, [busy, draft, notice, props.snapshot.revisionId]);

  const eligibleColumns = props.snapshot.columns.filter((column) => column.canUseAsFormulaOperand);
  const beginDraft = (): void => {
    if (props.blocked || activeRequestRef.current !== null || !props.snapshot.canAddFormulaColumn) return;
    const firstColumn = eligibleColumns[0];
    if (!firstColumn) return;
    setNotice(null);
    setDraft({
      mode: "add",
      expectedRevisionId: props.snapshot.revisionId,
      label: "",
      leftColumnId: firstColumn.columnId,
      operator: "add",
      rightKind: "literal",
      rightColumnId: eligibleColumns[1]?.columnId ?? firstColumn.columnId,
      literal: "0"
    });
    props.onActiveChange(true);
    pendingDraftFocusRef.current = true;
  };

  const beginEdit = (columnId: string): void => {
    if (props.blocked || activeRequestRef.current !== null) return;
    const column = props.snapshot.columns.find((candidate) => candidate.columnId === columnId);
    const editable = column?.canEditFormula ? editableFormula(column.calculation) : null;
    if (!column || !editable) return;
    setNotice(null);
    setDraft({
      mode: "edit",
      columnId: column.columnId,
      expectedRevisionId: props.snapshot.revisionId,
      label: column.label,
      ...editable
    });
    props.onActiveChange(true);
    pendingDraftFocusRef.current = true;
  };

  useEffect(() => {
    const request = props.requestedEdit;
    if (!request) return;
    props.onEditRequestHandled();
    if (request.ownerKey !== ownerKey || request.revisionId !== props.snapshot.revisionId) return;
    beginEdit(request.columnId);
  }, [props.requestedEdit]);

  const cancelDraft = (): void => {
    if (busy) return;
    const columnId = draft?.mode === "edit" ? draft.columnId : undefined;
    setDraft(null);
    setNotice(null);
    props.onActiveChange(false);
    if (columnId) props.onFocusColumn(columnId);
    else pendingTriggerFocusRef.current = true;
  };

  const submit = async (): Promise<void> => {
    if (!draft || props.blocked || activeRequestRef.current !== null) return;
    const editedColumn = draft.mode === "edit"
      ? props.snapshot.columns.find((column) => column.columnId === draft.columnId)
      : undefined;
    if ((draft.mode === "add" && !props.snapshot.canAddFormulaColumn) ||
        (draft.mode === "edit" && !editedColumn?.canEditFormula)) return;
    const label = draft.label.trim();
    const left = eligibleColumns.find((column) => column.columnId === draft.leftColumnId);
    const rightColumn = draft.rightKind === "column"
      ? eligibleColumns.find((column) => column.columnId === draft.rightColumnId)
      : undefined;
    const literal = draft.rightKind === "literal" && draft.literal.trim().length > 0
      ? Number(draft.literal)
      : Number.NaN;
    if (!left || (draft.mode === "add" && label.length === 0) ||
        (draft.rightKind === "column" ? !rightColumn : !Number.isFinite(literal))) return;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    activeRequestRef.current = sequence;
    const requestIdentity = {
      apiVersion: 1 as const,
      requestId: createCollectionRequestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId: draft.expectedRevisionId
    };
    const expression: DatasetPigeFormulaExpression = {
      kind: "binary",
      operator: draft.operator,
      left: { kind: "column", columnId: left.columnId },
      right: rightColumn
        ? { kind: "column", columnId: rightColumn.columnId }
        : { kind: "literal", value: literal }
    };
    const request: CollectionAddFormulaColumnRequest | CollectionUpdateFormulaColumnRequest = draft.mode === "edit"
      ? { ...requestIdentity, columnId: editedColumn!.columnId, expression }
      : { ...requestIdentity, label, expression };
    const expectedOwnerKey = ownerKey;
    setBusy(true);
    setNotice(null);
    try {
      const result = "columnId" in request
        ? await window.pige.collections.updateFormulaColumn(request)
        : await window.pige.collections.addFormulaColumn(request);
      if (!isCurrent(sequence, expectedOwnerKey, request.expectedRevisionId) || !identityMatches(request, result)) return;
      if ((result.status === "committed" || result.status === "stale") &&
          !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      if (result.status === "committed") {
        setDraft(null);
        setNotice("columnId" in request ? "updated" : "added");
        props.onActiveChange(false);
        props.onFocusColumn(result.columnId);
        return;
      }
      if (result.status === "stale") {
        setDraft((current) => current ? { ...current, expectedRevisionId: result.snapshot.revisionId } : current);
      }
      setNotice(formulaNotice(request, result));
      pendingDraftFocusRef.current = true;
    } catch {
      if (isCurrent(sequence, expectedOwnerKey)) {
        setNotice(draft.mode === "edit" ? "update_failed" : "failed");
        pendingDraftFocusRef.current = true;
      }
    } finally {
      if (activeRequestRef.current === sequence) activeRequestRef.current = null;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) {
        setBusy(false);
      }
    }
  };

  const rightIsValid = draft?.rightKind === "column"
    ? eligibleColumns.some((column) => column.columnId === draft.rightColumnId)
    : draft !== null && draft.literal.trim().length !== 0 && Number.isFinite(Number(draft.literal));
  const draftHasAuthority = draft?.mode === "edit"
    ? props.snapshot.columns.some((column) => column.columnId === draft.columnId && column.canEditFormula)
    : props.snapshot.canAddFormulaColumn;
  if (!draft && (!props.snapshot.canAddFormulaColumn || eligibleColumns.length === 0)) return null;
  return (
    <section className="settings-card settings-row tall" aria-label={props.t(draft?.mode === "edit" ? "collection.formulaEditor" : "collection.formulaBuilder")}>
      {!draft ? (
        <div className="settings-row-control">
          <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy} onClick={beginDraft}>
            {props.t("collection.addFormulaField")}
          </button>
        </div>
      ) : (
        <form
          aria-label={props.t(draft.mode === "edit" ? "collection.formulaEditor" : "collection.formulaBuilder")}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelDraft(); } }}
        >
          {draft.mode === "add" ? (
            <div className="settings-row-copy">
              <label htmlFor="collection-formula-name"><strong>{props.t("collection.fieldName")}</strong></label>
              <input ref={nameRef} id="collection-formula-name" className="settings-input" value={draft.label} maxLength={120} disabled={busy} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setNotice(null); }} />
            </div>
          ) : <div className="settings-row-copy"><strong>{props.t("collection.editFormula")}: {draft.label}</strong></div>}
          <div className="settings-row-copy">
            <label htmlFor="collection-formula-left"><strong>{props.t("collection.formulaLeftOperand")}</strong></label>
            <select ref={leftRef} id="collection-formula-left" className="settings-input" value={draft.leftColumnId} disabled={busy} onChange={(event) => { setDraft({ ...draft, leftColumnId: event.target.value }); setNotice(null); }}>
              {formulaColumnOptions(eligibleColumns, draft.leftColumnId, props.snapshot)}
            </select>
          </div>
          <div className="settings-row-copy">
            <label htmlFor="collection-formula-operator"><strong>{props.t("collection.formulaOperator")}</strong></label>
            <select id="collection-formula-operator" className="settings-input" value={draft.operator} disabled={busy} onChange={(event) => { setDraft({ ...draft, operator: event.target.value as FormulaOperator }); setNotice(null); }}>
              <option value="add">+</option><option value="subtract">−</option><option value="multiply">×</option><option value="divide">÷</option>
            </select>
          </div>
          <div className="settings-row-copy">
            <label htmlFor="collection-formula-right"><strong>{props.t("collection.formulaRightOperand")}</strong></label>
            <select id="collection-formula-right" className="settings-input" value={draft.rightKind === "literal" ? "" : draft.rightColumnId} disabled={busy} onChange={(event) => { setDraft({ ...draft, rightKind: event.target.value ? "column" : "literal", ...(event.target.value ? { rightColumnId: event.target.value } : {}) }); setNotice(null); }}>
              <option value="">{props.t("collection.formulaLiteral")}</option>
              {formulaColumnOptions(eligibleColumns, draft.rightColumnId, props.snapshot)}
            </select>
          </div>
          {draft.rightKind === "literal" ? (
            <div className="settings-row-copy">
              <label htmlFor="collection-formula-literal"><strong>{props.t("collection.formulaLiteral")}</strong></label>
              <input id="collection-formula-literal" className="settings-input" inputMode="decimal" value={draft.literal} disabled={busy} onInput={(event) => { setDraft({ ...draft, literal: event.currentTarget.value }); setNotice(null); }} />
            </div>
          ) : null}
          <div className="settings-row-control">
            <button type="submit" className="settings-button primary" disabled={busy || props.blocked || !draftHasAuthority || (draft.mode === "add" && draft.label.trim().length === 0) || !eligibleColumns.some((column) => column.columnId === draft.leftColumnId) || !rightIsValid}>{props.t(busy ? "collection.saving" : "collection.save")}</button>
            <button type="button" className="settings-button" disabled={busy} onClick={cancelDraft}>{props.t("collection.cancel")}</button>
          </div>
        </form>
      )}
      {notice ? <p className={`settings-inline-status ${notice === "added" || notice === "updated" ? "success" : "error"}`} role="status">{props.t(`collection.formula_${notice}`)}</p> : null}
    </section>
  );

  function isCurrent(sequence: number, expectedOwnerKey: string, expectedRevisionId?: string): boolean {
    return sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey &&
      (expectedRevisionId === undefined || revisionRef.current === expectedRevisionId);
  }
}

function formulaColumnOptions(
  eligibleColumns: CollectionSnapshot["columns"],
  selectedColumnId: string,
  snapshot: CollectionSnapshot
): React.JSX.Element[] {
  const selected = snapshot.columns.find((column) => column.columnId === selectedColumnId);
  const columns = selected && !eligibleColumns.some((column) => column.columnId === selected.columnId)
    ? [selected, ...eligibleColumns]
    : eligibleColumns;
  return columns.map((column) => <option value={column.columnId} key={column.columnId}>{column.label}</option>);
}

function editableFormula(
  calculation: CollectionSnapshot["columns"][number]["calculation"]
): Pick<FormulaDraft, "leftColumnId" | "operator" | "rightKind" | "rightColumnId" | "literal"> | null {
  if (calculation?.kind !== "pige_numeric_formula") return null;
  const expression = calculation.expression;
  if (expression.kind !== "binary" || expression.left.kind !== "column" ||
      (expression.right.kind !== "column" && expression.right.kind !== "literal")) return null;
  return {
    leftColumnId: expression.left.columnId,
    operator: expression.operator,
    rightKind: expression.right.kind,
    rightColumnId: expression.right.kind === "column" ? expression.right.columnId : expression.left.columnId,
    literal: expression.right.kind === "literal" ? String(expression.right.value) : "0"
  };
}

function formulaNotice(
  request: CollectionAddFormulaColumnRequest | CollectionUpdateFormulaColumnRequest,
  result: CollectionAddFormulaColumnResult | CollectionUpdateFormulaColumnResult
): FormulaNotice {
  if (result.status === "committed") return "label" in request ? "added" : "updated";
  if (result.status === "stale") return "stale";
  if ("label" in request) {
    if (result.status === "invalid") return result.reason === "duplicate_label"
      ? "duplicate" : result.reason === "column_limit" ? "limit" : "ineligible";
    return result.status;
  }
  if (result.status === "invalid") return result.reason === "no_change" ? "update_no_change" : "update_ineligible";
  return result.status === "not_found" ? "update_not_found" : "update_failed";
}

function identityMatches(
  request: CollectionAddFormulaColumnRequest | CollectionUpdateFormulaColumnRequest,
  result: CollectionAddFormulaColumnResult | CollectionUpdateFormulaColumnResult
): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId && result.tableId === request.tableId &&
    (!("columnId" in request) || ("columnId" in result && result.columnId === request.columnId));
}

function createCollectionRequestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
