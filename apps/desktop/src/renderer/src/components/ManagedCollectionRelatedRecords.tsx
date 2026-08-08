import { useLayoutEffect, useRef } from "react";
import type { CollectionOpenRelatedRecordsResult } from "@pige/schemas";
import { formatCollectionCellValue } from "./ManagedCollectionScalarCellEditor";

type RelatedRecordReady = Extract<CollectionOpenRelatedRecordsResult, { readonly status: "ready" }>;

export function ManagedCollectionRelatedRecordPanel(props: {
  readonly result: CollectionOpenRelatedRecordsResult | null;
  readonly loading?: boolean;
  readonly onClose: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const panelRef = useRef<HTMLElement | null>(null);
  const ready = props.result?.status === "ready" ? props.result : undefined;
  const snapshot = ready?.snapshot ?? (props.result?.status === "empty" ? props.result.snapshot : undefined);
  const statusMessage = props.loading ? props.t("collection.openingRelatedRecord")
    : props.result?.status === "stale" ? props.t("collection.relatedStale")
    : props.result?.status === "not_found" || props.result?.status === "ineligible" ? props.t("collection.relatedUnavailable")
    : props.result?.status === "failed" ? props.t("collection.relatedFailed")
    : props.result?.status === "empty" ? props.t("collection.relatedEmpty") : undefined;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const target = props.loading ? null : panel.querySelector<HTMLElement>('[data-related-target="true"]');
    (target ?? panel).focus({ preventScroll: true });
  }, [props.loading, props.result]);
  const state = props.loading ? "loading" : props.result?.status ?? "unknown";
  return (
    <section ref={panelRef} className="settings-card settings-row tall managed-collection-related-record" aria-labelledby="managed-collection-related-record-title" aria-busy={props.loading || undefined} data-related-state={state} role="region" tabIndex={-1}>
      <header className="dataset-answer-header">
        <div>
          <p className="retrieval-eyebrow">{props.t("collection.relatedRecords")}</p>
          <h2 id="managed-collection-related-record-title">{snapshot?.tableName ?? props.t("collection.relatedRecords")}</h2>
        </div>
        <button type="button" className="ghost back-button" disabled={props.loading} onClick={props.onClose}>{props.t("collection.back")}</button>
      </header>
      {statusMessage ? <p className={props.result?.status === "empty" || props.loading ? "muted" : "settings-inline-status error"} role="status" aria-live="polite">{statusMessage}</p> : null}
      {snapshot && ready ? <RelatedRecordTable ready={ready} t={props.t} /> : null}
    </section>
  );
}

function RelatedRecordTable(props: { readonly ready: RelatedRecordReady; readonly t: (key: string) => string }): React.JSX.Element {
  return (
    <div className="dataset-table-scroll" tabIndex={0} aria-label={props.t("collection.relatedTable")}>
      <table className="dataset-table">
        <caption>{props.ready.snapshot.tableName}</caption>
        <thead><tr>{props.ready.snapshot.columns.map((column) => <th scope="col" key={column.columnId}>{column.label}</th>)}</tr></thead>
        <tbody>{props.ready.snapshot.rows.map((row) => (
          <tr key={row.rowId} data-related-row-id={row.rowId} data-related-target={row.rowId === props.ready.targetRowId ? "true" : undefined} tabIndex={-1} aria-current={row.rowId === props.ready.targetRowId ? "true" : undefined}>
            {props.ready.snapshot.columns.map((column) => {
              const cell = row.cells.find((candidate) => candidate.columnId === column.columnId);
              return <td key={column.columnId}>{cell ? formatCollectionCellValue(cell.value) : "-"}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
      {props.ready.snapshot.truncated ? <p className="muted retrieval-warning">{props.t("dataset.truncated")}</p> : null}
    </div>
  );
}
