import { useLayoutEffect, useRef, useState } from "react";
import type { CollectionSnapshot, CollectionTrashTableRequest, CollectionTrashTableResult } from "@pige/schemas";

/** Explicit, trash-first removal for a table that remains reachable through immutable history and Activity Undo. */
export function ManagedCollectionTableTrashAction(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onTrashed: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const ownerRef = useRef(ownerKey(props));
  ownerRef.current = ownerKey(props);
  useLayoutEffect(() => { if (!confirming && !busy) triggerRef.current?.focus(); }, [confirming, busy]);
  if (!props.snapshot.canTrashTable) return null;

  const submit = async (): Promise<void> => {
    if (busy || props.blocked) return;
    const request: CollectionTrashTableRequest = { apiVersion: 1, requestId: createRequestId(),
      activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId, tableId: props.snapshot.tableId,
      expectedRevisionId: props.snapshot.revisionId };
    const owner = ownerKey(props); setBusy(true); props.onBusyChange(true); setStatus(null);
    try {
      const result = await window.pige.collections.trashTable(request);
      if (ownerRef.current !== owner || !sameIdentity(request, result)) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      setStatus(props.t(`collection.trashTable_${result.status}`));
      if (result.status === "committed") props.onTrashed();
    } catch {
      if (ownerRef.current === owner) setStatus(props.t("collection.trashTable_failed"));
    } finally {
      if (ownerRef.current === owner) { setBusy(false); props.onBusyChange(false); }
    }
  };

  return <div className="settings-row-control">
    <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy}
      onClick={() => { setStatus(null); setConfirming(true); }}>
      {props.t("collection.trashTable")}
    </button>
    {confirming ? <div className="settings-card settings-row tall" role="alertdialog" aria-label={props.t("collection.trashTable") }>
      <span>{props.t("collection.trashTable_confirm")}</span>
      <div className="settings-row-control">
        <button type="button" className="settings-button primary" disabled={busy} onClick={() => void submit()}>
          {props.t(busy ? "collection.trashingTable" : "collection.trashTable_confirmAction")}
        </button>
        <button type="button" className="settings-button" disabled={busy} onClick={() => { setConfirming(false); setStatus(null); }}>
          {props.t("collection.cancel")}
        </button>
      </div>
    </div> : null}
    {status ? <span className="settings-inline-status" role="status" aria-live="polite">{status}</span> : null}
  </div>;
}

function ownerKey(props: { readonly activeVaultId: string; readonly snapshot: CollectionSnapshot }): string {
  return `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
}
function sameIdentity(request: CollectionTrashTableRequest, result: CollectionTrashTableResult): boolean {
  return request.requestId === result.requestId && request.activeVaultId === result.activeVaultId &&
    request.datasetId === result.datasetId && request.tableId === result.tableId;
}
function createRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `collection_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
