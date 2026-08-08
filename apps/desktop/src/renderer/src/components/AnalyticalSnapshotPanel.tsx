import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  CollectionAnalyticalSnapshotCitationResult,
  CollectionAnalyticalSnapshotCreateResult,
  CollectionAnalyticalSnapshotListResult,
  CollectionAnalyticalSnapshotOpenResult,
  CollectionAnalyticalSnapshotPreview,
  CollectionAnalyticalSnapshotSummary,
  CollectionSnapshot
} from "@pige/schemas";
import { formatCollectionCellValue } from "./ManagedCollectionScalarCellEditor";

type SnapshotNotice = "created" | "stale" | "not_found" | "failed" | "citation_ready";

export function AnalyticalSnapshotPanel(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked?: boolean;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [snapshots, setSnapshots] = useState<readonly CollectionAnalyticalSnapshotSummary[]>([]);
  const [preview, setPreview] = useState<CollectionAnalyticalSnapshotPreview | null>(null);
  const [citation, setCitation] = useState<Extract<CollectionAnalyticalSnapshotCitationResult, { readonly status: "ready" }>["citation"] | null>(null);
  const [notice, setNotice] = useState<SnapshotNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlightRef = useRef(false);
  const requestSequence = useRef(0);
  const ownerKey = `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}:${props.snapshot.revisionId}`;
  const ownerKeyRef = useRef(ownerKey);
  const revisionRef = useRef(props.snapshot.revisionId);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const focusCreateRef = useRef(false);
  ownerKeyRef.current = ownerKey;
  revisionRef.current = props.snapshot.revisionId;

  useEffect(() => {
    requestSequence.current += 1;
    setSnapshots([]);
    setPreview(null);
    setCitation(null);
    setNotice(null);
    setBusy(false);
    void loadSnapshots(requestSequence.current, ownerKey);
  }, [ownerKey]);

  useLayoutEffect(() => {
    if (!focusCreateRef.current || busy) return;
    focusCreateRef.current = false;
    (createButtonRef.current ?? panelRef.current)?.focus({ preventScroll: true });
  }, [busy, notice, snapshots]);

  const requestId = (): string =>
    `collection_request_snapshot${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`)
      .replaceAll("-", "").toLowerCase()}`;

  const loadSnapshots = async (sequence: number, expectedOwnerKey: string): Promise<void> => {
    const request = { apiVersion: 1 as const, requestId: requestId(), activeVaultId: props.activeVaultId };
    let result: CollectionAnalyticalSnapshotListResult;
    try {
      result = await window.pige.collections.listAnalyticalSnapshots(request);
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setNotice("failed");
      return;
    }
    if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
        result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId) return;
    if (result.status !== "ready") {
      setNotice("failed");
      return;
    }
    setSnapshots(result.snapshots.filter((item) =>
      item.datasetId === props.snapshot.datasetId && item.tableId === props.snapshot.tableId
    ));
  };

  const createSnapshot = async (): Promise<void> => {
    if (busy || inFlightRef.current || props.blocked) return;
    inFlightRef.current = true;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    const expectedRevisionId = props.snapshot.revisionId;
    const request = {
      apiVersion: 1 as const,
      requestId: requestId(),
      activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId,
      tableId: props.snapshot.tableId,
      expectedRevisionId
    };
    focusCreateRef.current = true;
    setBusy(true);
    setNotice(null);
    setCitation(null);
    try {
      const result: CollectionAnalyticalSnapshotCreateResult = await window.pige.collections.createAnalyticalSnapshot(request);
      if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
          revisionRef.current !== expectedRevisionId || result.requestId !== request.requestId ||
          result.activeVaultId !== request.activeVaultId || result.datasetId !== request.datasetId ||
          result.tableId !== request.tableId || result.expectedRevisionId !== request.expectedRevisionId) return;
      if (result.status === "committed" || result.status === "already_committed") {
        setSnapshots((current) => current.some((item) => item.snapshotId === result.snapshot.snapshotId)
          ? current : [...current, result.snapshot]);
        setNotice("created");
        await openSnapshot(result.snapshot.snapshotId, sequence, expectedOwnerKey, true);
      } else {
        setNotice(result.status === "stale" ? "stale" : result.status === "not_found" ? "not_found" : "failed");
      }
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setNotice("failed");
    } finally {
      inFlightRef.current = false;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const openSnapshot = async (snapshotId: string, sequence = requestSequence.current + 1, expectedOwnerKey = ownerKey, continuation = false): Promise<void> => {
    if (!continuation && (busy || inFlightRef.current)) return;
    if (!continuation) inFlightRef.current = true;
    requestSequence.current = sequence;
    const request = { apiVersion: 1 as const, requestId: requestId(), activeVaultId: props.activeVaultId, snapshotId };
    setBusy(true);
    setNotice(null);
    try {
      const result: CollectionAnalyticalSnapshotOpenResult = await window.pige.collections.openAnalyticalSnapshot(request);
      if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
          result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId ||
          result.snapshotId !== request.snapshotId) return;
      if (result.status === "ready") {
        setPreview(result.preview);
        setCitation(null);
      } else setNotice(result.status === "stale" ? "stale" : result.status === "not_found" ? "not_found" : "failed");
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setNotice("failed");
    } finally {
      if (!continuation) inFlightRef.current = false;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  const openCitation = async (rowId: string): Promise<void> => {
    if (busy || inFlightRef.current || !preview) return;
    inFlightRef.current = true;
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const expectedOwnerKey = ownerKey;
    const request = { apiVersion: 1 as const, requestId: requestId(), activeVaultId: props.activeVaultId, snapshotId: preview.snapshotId, rowId };
    setBusy(true);
    setNotice(null);
    try {
      const result: CollectionAnalyticalSnapshotCitationResult = await window.pige.collections.openAnalyticalSnapshotCitation(request);
      if (sequence !== requestSequence.current || ownerKeyRef.current !== expectedOwnerKey ||
          result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId ||
          result.snapshotId !== request.snapshotId || result.rowId !== request.rowId) return;
      if (result.status === "ready") {
        setCitation(result.citation);
        setNotice("citation_ready");
      } else setNotice(result.status === "stale" ? "stale" : result.status === "not_found" ? "not_found" : "failed");
    } catch {
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setNotice("failed");
    } finally {
      inFlightRef.current = false;
      if (sequence === requestSequence.current && ownerKeyRef.current === expectedOwnerKey) setBusy(false);
    }
  };

  return (
    <section ref={panelRef} className="settings-card analytical-snapshot-panel" aria-labelledby="analytical-snapshot-title" tabIndex={-1}>
      <div className="settings-row-copy">
        <p className="retrieval-eyebrow">{props.t("collection.snapshotEyebrow")}</p>
        <h2 id="analytical-snapshot-title">{props.t("collection.snapshotTitle")}</h2>
        <p className="muted">{props.t("collection.snapshotDescription")}</p>
      </div>
      <div className="settings-row-control">
        <button ref={createButtonRef} type="button" className="settings-button" disabled={busy || props.blocked} onClick={() => void createSnapshot()}>
          {props.t(busy ? "collection.snapshotWorking" : "collection.snapshotCreate")}
        </button>
      </div>
      {snapshots.length > 0 ? (
        <ul className="settings-list" aria-label={props.t("collection.snapshotList")}>
          {snapshots.map((item) => (
            <li key={item.snapshotId} className="settings-row">
              <div className="settings-row-copy"><strong>{item.title}</strong><span className="muted">{item.tableName} · {item.rowCount} {props.t("collection.rows")}</span></div>
              <button type="button" className="settings-button" disabled={busy} onClick={() => void openSnapshot(item.snapshotId)}>{props.t("collection.snapshotOpen")}</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{props.t("collection.snapshotEmpty")}</p>}
      {preview ? (
        <div className="dataset-answer analytical-snapshot-preview" aria-labelledby="analytical-snapshot-preview-title">
          <div className="settings-row-copy"><h3 id="analytical-snapshot-preview-title">{preview.tableName}</h3><span className="muted">{preview.returnedRowCount}/{preview.totalRowCount} {props.t("collection.rows")}</span></div>
          <div className="dataset-table-scroll" tabIndex={0} aria-label={props.t("collection.snapshotTable")}>
            <table className="dataset-table"><caption>{preview.tableName}</caption><thead><tr>{preview.columns.map((column) => <th scope="col" key={column.columnId}>{column.label}</th>)}<th scope="col">{props.t("collection.snapshotCitation")}</th></tr></thead>
              <tbody>{preview.rows.map((row) => <tr key={row.rowId}><td colSpan={preview.columns.length + 1}>{row.cells.map((cell) => <span key={cell.columnId}>{formatCollectionCellValue(cell.value)} </span>)}<button type="button" className="settings-button" disabled={busy} onClick={() => void openCitation(row.rowId)}>{props.t("collection.snapshotCite")}</button></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : null}
      {citation ? <p className="settings-inline-status success" role="status">{props.t("collection.snapshotCitationReady")} · {citation.citationRef}</p> : null}
      {notice && notice !== "created" && notice !== "citation_ready" ? <p className="settings-inline-status error" role="status">{props.t(`collection.snapshot_${notice}`)}</p> : null}
    </section>
  );
}
