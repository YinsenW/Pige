import { useLayoutEffect, useRef, useState } from "react";
import type { CollectionAddTableRequest, CollectionAddTableResult, CollectionSnapshot } from "@pige/schemas";

export function ManagedCollectionTableAddAction(props: {
  readonly activeVaultId: string;
  readonly snapshot: CollectionSnapshot;
  readonly blocked: boolean;
  readonly onAdoptSnapshot: (snapshot: CollectionSnapshot, expectedRevisionId: string, expectedTableId?: string) => boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef(ownerKey(props));
  ownerRef.current = ownerKey(props);
  useLayoutEffect(() => { if (open && !busy) inputRef.current?.focus(); }, [open, busy]);

  const close = (): void => {
    if (busy) return;
    setOpen(false); setStatus(null); setDraft("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const submit = async (): Promise<void> => {
    const name = draft.trim();
    if (busy || props.blocked || !name) return;
    const request: CollectionAddTableRequest = { apiVersion: 1, requestId: createRequestId(), activeVaultId: props.activeVaultId,
      datasetId: props.snapshot.datasetId, expectedRevisionId: props.snapshot.revisionId, name };
    const owner = ownerKey(props); setBusy(true); props.onBusyChange(true); setStatus(null);
    try {
      const result = await window.pige.collections.addTable(request);
      if (ownerRef.current !== owner || !sameIdentity(request, result)) return;
      if (result.status === "committed" && !props.onAdoptSnapshot(result.snapshot, request.expectedRevisionId, props.snapshot.tableId)) return;
      setStatus(props.t(`collection.addTable_${result.status}`));
      if (result.status === "committed") {
        setOpen(false); setDraft("");
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    } catch {
      if (ownerRef.current === owner) setStatus(props.t("collection.addTable_failed"));
    } finally {
      if (ownerRef.current === owner) { setBusy(false); props.onBusyChange(false); }
    }
  };

  return <div className="settings-row-control">
    <button ref={triggerRef} type="button" className="settings-button" disabled={props.blocked || busy}
      onClick={() => { setDraft(""); setStatus(null); setOpen(true); }}>{props.t("collection.addTable")}</button>
    {open ? <form className="settings-card settings-row tall" aria-label={props.t("collection.addTable")}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="collection-new-table-name"><strong>{props.t("collection.tableName")}</strong></label>
      <input ref={inputRef} id="collection-new-table-name" className="settings-input" value={draft} maxLength={120}
        disabled={busy} onInput={(event) => { setDraft(event.currentTarget.value); setStatus(null); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } }} />
      <div className="settings-row-control"><button type="submit" className="settings-button primary" disabled={busy || !draft.trim()}>
        {props.t(busy ? "collection.addingTable" : "collection.addTable")}</button><button type="button" className="settings-button" disabled={busy} onClick={close}>{props.t("collection.cancel")}</button></div>
    </form> : null}
    {status ? <span className="settings-inline-status" role="status" aria-live="polite">{status}</span> : null}
  </div>;
}

function ownerKey(props: { readonly activeVaultId: string; readonly snapshot: CollectionSnapshot }): string {
  return `${props.activeVaultId}:${props.snapshot.datasetId}:${props.snapshot.tableId}`;
}
function sameIdentity(request: CollectionAddTableRequest, result: CollectionAddTableResult): boolean {
  return request.requestId === result.requestId && request.activeVaultId === result.activeVaultId &&
    request.datasetId === result.datasetId && request.name === result.name;
}
function createRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `collection_request_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}
