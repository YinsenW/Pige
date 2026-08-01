import { useEffect, useRef, useState } from "react";
import type { CollectionDatasetSummary, CollectionTrashDatasetRequest, CollectionTrashDatasetResult } from "@pige/schemas";

export function ManagedDatasetTrashAction(props: {
  readonly activeVaultId: string;
  readonly dataset: CollectionDatasetSummary;
  readonly onTrash: (request: CollectionTrashDatasetRequest) => Promise<CollectionTrashDatasetResult>;
  readonly onCommitted: (datasetId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const activeRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const ownerKey = `${props.activeVaultId}:${props.dataset.datasetId}:${props.dataset.activeRevisionId}`;
  const ownerKeyRef = useRef(ownerKey);
  ownerKeyRef.current = ownerKey;
  useEffect(() => { activeRef.current = false; setOpen(false); setPending(false); setStatus(null); }, [ownerKey]);
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);
  if (!props.dataset.canTrash) return null;
  const close = (): void => {
    if (activeRef.current) return;
    setOpen(false); setStatus(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const submit = async (): Promise<void> => {
    if (activeRef.current) return;
    const identity = ownerKey;
    const request: CollectionTrashDatasetRequest = {
      apiVersion: 1,
      requestId: `collection_request_${crypto.randomUUID().replace(/-/gu, "")}`,
      activeVaultId: props.activeVaultId,
      datasetId: props.dataset.datasetId,
      expectedRevisionId: props.dataset.activeRevisionId
    };
    activeRef.current = true; setPending(true); setStatus(null);
    try {
      const result = await props.onTrash(request);
      if (ownerKeyRef.current !== identity || result.requestId !== request.requestId ||
          result.activeVaultId !== request.activeVaultId || result.datasetId !== request.datasetId ||
          result.expectedRevisionId !== request.expectedRevisionId) return;
      if (result.status === "committed") { setOpen(false); props.onCommitted(request.datasetId); return; }
      setStatus(props.t(`collection.trashDataset_${result.status}`));
      requestAnimationFrame(() => confirmRef.current?.focus());
    } catch {
      if (ownerKeyRef.current === identity) {
        setStatus(props.t("collection.trashDataset_failed"));
        requestAnimationFrame(() => confirmRef.current?.focus());
      }
    } finally {
      if (ownerKeyRef.current === identity) { activeRef.current = false; setPending(false); }
    }
  };
  return <>
    <button ref={triggerRef} type="button" className="settings-button" onClick={() => setOpen(true)}>
      {props.t("collection.trashDataset")}
    </button>
    {open ? <div className="confirmation-backdrop"><section className="confirmation-dialog" role="alertdialog"
      aria-modal="true" aria-labelledby={`trash-dataset-${props.dataset.datasetId}`} aria-busy={pending}>
      <h2 id={`trash-dataset-${props.dataset.datasetId}`}>{props.t("collection.trashDatasetTitle")}</h2>
      <p>{props.t("collection.trashDatasetDescription")}</p>
      {status ? <p role="alert">{status}</p> : null}
      <div className="confirmation-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={close}>{props.t("common.cancel")}</button>
        <button ref={confirmRef} type="button" className="danger-button" disabled={pending} onClick={() => void submit()}>
          {props.t(pending ? "collection.trashingDataset" : "collection.trashDataset")}
        </button>
      </div>
    </section></div> : null}
  </>;
}
