import { useEffect, useRef, useState } from "react";
import type {
  CollectionRevisionHistorySummary,
  CollectionSnapshot
} from "@pige/schemas";
import { formatCollectionCellValue } from "./ManagedCollectionScalarCellEditor";

interface Props {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly t: (key: string) => string;
}

export function ManagedCollectionRevisionHistory(props: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revisions, setRevisions] = useState<CollectionRevisionHistorySummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [preview, setPreview] = useState<CollectionSnapshot>();
  const [confirmRevisionId, setConfirmRevisionId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}:${props.snapshot.revisionId}`;

  useEffect(() => {
    setOpen(false); setBusy(false); setRevisions([]); setNextCursor(undefined);
    setPreview(undefined); setConfirmRevisionId(undefined); setNotice(undefined);
  }, [ownerKey]);

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const close = (): void => {
    if (busy) return;
    setOpen(false); setPreview(undefined); setConfirmRevisionId(undefined); setNotice(undefined);
    queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
  };

  const load = async (cursor?: string): Promise<void> => {
    if (busy) return;
    setBusy(true); setNotice(undefined);
    const expectedRevisionId = props.snapshot.revisionId;
    try {
      const result = await window.pige.collections.listRevisionHistory({ apiVersion: 1,
        requestId: requestId(), activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId,
        expectedCurrentRevisionId: expectedRevisionId, limit: 25, ...(cursor ? { cursor } : {}) });
      if (result.status === "ready" && result.currentRevisionId === expectedRevisionId) {
        setRevisions((current) => cursor ? mergeRevisions(current, result.revisions) : result.revisions);
        setNextCursor(result.nextCursor);
      } else setNotice(result.status === "stale" ? "collection.historyStale" : "collection.historyFailed");
    } catch { setNotice("collection.historyFailed"); }
    finally { setBusy(false); }
  };

  const showPreview = async (revisionId: string): Promise<void> => {
    if (busy) return;
    setBusy(true); setNotice(undefined); setConfirmRevisionId(undefined);
    try {
      const result = await window.pige.collections.openRevisionHistory({ apiVersion: 1,
        requestId: requestId(), activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId,
        expectedCurrentRevisionId: props.snapshot.revisionId, revisionId, tableId: props.snapshot.tableId });
      if (result.status === "ready" && result.readOnly) setPreview(result.snapshot);
      else setNotice(result.status === "stale" ? "collection.historyStale" : "collection.historyFailed");
    } catch { setNotice("collection.historyFailed"); }
    finally { setBusy(false); }
  };

  const restore = async (revisionId: string): Promise<void> => {
    if (busy || confirmRevisionId !== revisionId) return;
    setBusy(true); setNotice(undefined);
    const expectedRevisionId = props.snapshot.revisionId;
    try {
      const result = await window.pige.collections.restoreRevisionHistory({ apiVersion: 1,
        requestId: requestId(), activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId,
        expectedCurrentRevisionId: expectedRevisionId, revisionId, tableId: props.snapshot.tableId,
        confirmation: "restore_as_new_revision" });
      if (result.status === "committed" && props.onAdoptSnapshot(result.snapshot, expectedRevisionId)) {
        setOpen(false); setPreview(undefined); setConfirmRevisionId(undefined);
        queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
      } else if (result.status === "stale") {
        props.onAdoptSnapshot(result.snapshot, expectedRevisionId);
        setNotice("collection.historyStale");
      } else setNotice(result.status === "ineligible" ? "collection.historyIneligible" : "collection.historyFailed");
    } catch { setNotice("collection.historyFailed"); }
    finally { setBusy(false); }
  };

  return <div className="managed-collection-history">
    <button ref={triggerRef} type="button" className="ghost" disabled={props.blocked || busy}
      aria-expanded={open} onClick={() => { if (open) close(); else { setOpen(true); void load(); } }}>
      {props.t("collection.history")}
    </button>
    {open ? <section ref={panelRef} className="settings-card" tabIndex={-1}
      aria-label={props.t("collection.historyTitle")}>
      <div className="settings-row"><div className="settings-row-copy">
        <strong>{props.t("collection.historyTitle")}</strong>
        <span className="muted">{props.t("collection.historyDescription")}</span>
      </div><button type="button" className="ghost" disabled={busy} onClick={close}>{props.t("collection.cancel")}</button></div>
      {notice ? <p className="settings-inline-status error" role="status">{props.t(notice)}</p> : null}
      {revisions.length === 0 && !busy ? <p className="muted">{props.t("collection.historyEmpty")}</p> : null}
      {revisions.map((revision) => <div className="settings-row" key={revision.revisionId}>
        <div className="settings-row-copy"><strong>{props.t(`collection.historyCategory.${revision.category}`)}
          {revision.isCurrent ? ` · ${props.t("collection.historyCurrent")}` : ""}</strong>
          <span className="muted">{new Date(revision.createdAt).toLocaleString()} · {revision.rowCount} {props.t("dataset.rows")}</span>
        </div><button type="button" className="settings-button" disabled={busy}
          onClick={() => void showPreview(revision.revisionId)}>{props.t("collection.historyPreview")}</button>
      </div>)}
      {nextCursor ? <button type="button" className="settings-button" disabled={busy}
        onClick={() => void load(nextCursor)}>{props.t(busy ? "collection.historyLoading" : "collection.historyLoadMore")}</button> : null}
      {preview ? <section className="dataset-answer" aria-label={props.t("collection.historyReadOnlyPreview")}>
        <p className="muted">{props.t("collection.historyReadOnlyPreview")}</p>
        <div className="dataset-table-scroll" tabIndex={0}><table className="dataset-table"><caption>{preview.tableName}</caption>
          <thead><tr>{preview.columns.map((column) => <th key={column.columnId}>{column.label}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.rowId}>{preview.columns.map((column) =>
            <td key={column.columnId}>{formatCollectionCellValue(row.cells.find((cell) => cell.columnId === column.columnId)?.value ?? null)}</td>)}</tr>)}</tbody>
        </table></div>
        {preview.revisionId !== props.snapshot.revisionId ? confirmRevisionId === preview.revisionId
          ? <div className="settings-inline-status" role="alert"><span>{props.t("collection.historyConfirm")}</span>
            <button type="button" className="settings-button" disabled={busy} onClick={() => void restore(preview.revisionId)}>
              {props.t(busy ? "collection.historyRestoring" : "collection.historyConfirmAction")}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmRevisionId(undefined)}>{props.t("collection.cancel")}</button></div>
          : <button type="button" className="settings-button" disabled={busy}
            onClick={() => setConfirmRevisionId(preview.revisionId)}>{props.t("collection.historyRestore")}</button> : null}
      </section> : null}
    </section> : null}
  </div>;
}

function requestId(): `collection_request_${string}` {
  return `collection_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}
function mergeRevisions(current: readonly CollectionRevisionHistorySummary[], next: readonly CollectionRevisionHistorySummary[]) {
  const seen = new Set(current.map(({ revisionId }) => revisionId));
  return [...current, ...next.filter(({ revisionId }) => !seen.has(revisionId))];
}
