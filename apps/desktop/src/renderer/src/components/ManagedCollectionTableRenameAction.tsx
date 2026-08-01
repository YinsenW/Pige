import { useLayoutEffect, useRef, useState } from "react";
import type { CollectionRenameTableRequest, CollectionRenameTableResult, CollectionSnapshot } from "@pige/schemas";

export function ManagedCollectionTableRenameAction(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onRename: (request: CollectionRenameTableRequest) => Promise<CollectionRenameTableResult>;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string) => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(props.snapshot.tableName);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef(ownerKey(props));
  ownerRef.current = ownerKey(props);
  useLayoutEffect(() => { if (open && !busy) inputRef.current?.focus(); }, [open, busy]);

  const close = (): void => {
    if (busy) return;
    setOpen(false); setStatus(null); setDraft(props.snapshot.tableName);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submit = async (): Promise<void> => {
    const name = draft.trim();
    if (busy || props.blocked || !name || name === props.snapshot.tableName) return;
    const request: CollectionRenameTableRequest = { apiVersion: 1, requestId: createRequestId(),
      activeVaultId: props.activeVaultId, datasetId: props.snapshot.datasetId, tableId: props.snapshot.tableId,
      expectedRevisionId: props.snapshot.revisionId, name };
    const owner = ownerKey(props); setBusy(true); props.onBusyChange(true); setStatus(null);
    try {
      const result = await props.onRename(request);
      if (ownerRef.current !== owner || !sameIdentity(request, result)) return;
      if ("snapshot" in result && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId)) return;
      setStatus(props.t(`collection.renameTable_${result.status}`));
      if (result.status === "committed") {
        setOpen(false); setDraft(result.snapshot.tableName);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    } catch {
      if (ownerRef.current === owner) setStatus(props.t("collection.renameTable_failed"));
    } finally {
      if (ownerRef.current === owner) { setBusy(false); props.onBusyChange(false); }
    }
  };

  return <div className="settings-row-control">
    <span className="muted">{props.snapshot.tableName}</span>
    <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy}
      onClick={() => { setDraft(props.snapshot.tableName); setStatus(null); setOpen(true); }}>
      {props.t("collection.renameTable")}
    </button>
    {open ? <form className="settings-card settings-row tall" aria-label={props.t("collection.renameTable")}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="collection-table-name"><strong>{props.t("collection.tableName")}</strong></label>
      <input ref={inputRef} id="collection-table-name" className="settings-input" value={draft} maxLength={120}
        disabled={busy} onInput={(event) => { setDraft(event.currentTarget.value); setStatus(null); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }} />
      <div className="settings-row-control">
        <button type="submit" className="settings-button primary"
          disabled={busy || !draft.trim() || draft.trim() === props.snapshot.tableName}>
          {props.t(busy ? "collection.renamingTable" : "collection.save")}
        </button>
        <button type="button" className="settings-button" disabled={busy} onClick={close}>{props.t("collection.cancel")}</button>
      </div>
    </form> : null}
    {status ? <span className="settings-inline-status" role="status" aria-live="polite">{status}</span> : null}
  </div>;
}

function ownerKey(props: { readonly activeVaultId: string; readonly snapshot: CollectionSnapshot }): string {
  return `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
}
function sameIdentity(request: CollectionRenameTableRequest, result: CollectionRenameTableResult): boolean {
  return request.requestId === result.requestId && request.activeVaultId === result.activeVaultId &&
    request.datasetId === result.datasetId && request.tableId === result.tableId && request.name === result.name;
}
function createRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `collection_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
