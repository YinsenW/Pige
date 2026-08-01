import { useEffect, useRef, useState } from "react";
import type { CollectionDatasetSummary, CollectionRenameDatasetRequest, CollectionRenameDatasetResult } from "@pige/schemas";

export function ManagedDatasetRenameAction(props: {
  readonly activeVaultId: string;
  readonly dataset: CollectionDatasetSummary;
  readonly onRename: (request: CollectionRenameDatasetRequest) => Promise<CollectionRenameDatasetResult>;
  readonly onCommitted: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(props.dataset.title);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.dataset.datasetId}:${props.dataset.activeRevisionId}`;
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  useEffect(() => { setOpen(false); setTitle(props.dataset.title); setPending(false); setStatus(null); }, [ownerKey]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  if (!props.dataset.canRename) return null;
  const close = (): void => {
    if (pending) return;
    setOpen(false); setTitle(props.dataset.title); setStatus(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const submit = async (): Promise<void> => {
    const normalized = title.trim();
    if (pending || !normalized || normalized === props.dataset.title) return;
    const identity = ownerKey;
    const request: CollectionRenameDatasetRequest = { apiVersion: 1,
      requestId: `collection_request_${crypto.randomUUID().replace(/-/gu, "")}`,
      activeVaultId: props.activeVaultId, datasetId: props.dataset.datasetId,
      expectedRevisionId: props.dataset.activeRevisionId, title: normalized };
    setPending(true); setStatus(null);
    try {
      const result = await props.onRename(request);
      if (ownerRef.current !== identity || result.requestId !== request.requestId ||
          result.datasetId !== request.datasetId || result.expectedRevisionId !== request.expectedRevisionId) return;
      if (result.status === "committed") { setOpen(false); props.onCommitted(); return; }
      setStatus(props.t(`collection.renameDataset_${result.status}`));
    } catch { if (ownerRef.current === identity) setStatus(props.t("collection.renameDataset_failed")); }
    finally { if (ownerRef.current === identity) setPending(false); }
  };
  return <>
    <button ref={triggerRef} type="button" className="settings-button" onClick={() => setOpen(true)}>
      {props.t("collection.renameDataset")}
    </button>
    {open ? <div className="confirmation-backdrop"><section className="confirmation-dialog" role="dialog"
      aria-modal="true" aria-labelledby={`rename-dataset-${props.dataset.datasetId}`} aria-busy={pending}>
      <h2 id={`rename-dataset-${props.dataset.datasetId}`}>{props.t("collection.renameDatasetTitle")}</h2>
      <label>{props.t("collection.datasetTitle")}
        <input ref={inputRef} value={title} maxLength={240} disabled={pending}
          onInput={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} />
      </label>
      {status ? <p role="alert">{status}</p> : null}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={close}>{props.t("common.cancel")}</button>
        <button type="button" className="primary-button" disabled={pending || !title.trim() || title.trim() === props.dataset.title}
          onClick={() => void submit()}>{props.t(pending ? "collection.renamingDataset" : "collection.renameDataset")}</button>
      </div>
    </section></div> : null}
  </>;
}
