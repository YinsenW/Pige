import { useEffect, useRef, useState } from "react";
import type { CollectionDatasetTrashSummary, CollectionListDatasetTrashResult } from "@pige/schemas";

export function ManagedDatasetTrashRestorePanel(props: {
  readonly activeVaultId: string;
  readonly onRestored: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Extract<CollectionListDatasetTrashResult, { status: "ready" }> | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
  const [notice, setNotice] = useState<"stale" | "failed" | "restored" | null>(null);
  const [purgeNotice, setPurgeNotice] = useState<"stale" | "failed" | "deleted" | null>(null);
  const [confirming, setConfirming] = useState<CollectionDatasetTrashSummary | null>(null);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusConfirmAfterResultRef = useRef(false);
  const focusAfterDeleteRef = useRef<string | "section" | null>(null);

  useEffect(() => {
    if (pendingOperationId !== null) return;
    if (focusConfirmAfterResultRef.current && confirming) {
      focusConfirmAfterResultRef.current = false; confirmRef.current?.focus(); return;
    }
    const target = focusAfterDeleteRef.current;
    if (target) {
      focusAfterDeleteRef.current = null;
      if (target === "section") sectionRef.current?.focus(); else deleteRefs.current.get(target)?.focus();
    }
  });

  useEffect(() => {
    generationRef.current += 1;
    pendingRef.current = false;
    setOpen(false); setResult(null); setPendingOperationId(null); setNotice(null); setPurgeNotice(null); setConfirming(null);
  }, [props.activeVaultId]);

  const load = async (): Promise<void> => {
    const generation = ++generationRef.current;
    try {
      const next = await window.pige.collections.listDatasetTrash({
        apiVersion: 1,
        requestId: `collection_request_${crypto.randomUUID().replaceAll("-", "")}`,
        activeVaultId: props.activeVaultId
      });
      if (generation !== generationRef.current) return;
      if (next.status === "ready") setResult(next);
      else { setResult(null); setNotice("failed"); }
    } catch {
      if (generation === generationRef.current) { setResult(null); setNotice("failed"); }
    }
  };

  const toggle = (): void => {
    if (open) {
      generationRef.current += 1; setOpen(false); setResult(null); setNotice(null); setPurgeNotice(null); setConfirming(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    setOpen(true); void load();
    requestAnimationFrame(() => sectionRef.current?.focus());
  };

  const restore = async (dataset: CollectionDatasetTrashSummary): Promise<void> => {
    if (!result || pendingRef.current) return;
    const generation = generationRef.current;
    pendingRef.current = true;
    setPendingOperationId(dataset.trashOperationId); setNotice(null);
    try {
      const restored = await window.pige.collections.restoreDataset({
        apiVersion: 1,
        requestId: `collection_request_${crypto.randomUUID().replaceAll("-", "")}`,
        activeVaultId: props.activeVaultId,
        datasetId: dataset.datasetId,
        expectedRevisionId: dataset.revisionId,
        trashOperationId: dataset.trashOperationId,
        expectedTrashRevision: result.revision
      });
      if (generation !== generationRef.current) return;
      if (restored.status === "committed") {
        setResult({ ...result, datasets: result.datasets.filter((candidate) => candidate.trashOperationId !== dataset.trashOperationId) });
        setNotice("restored"); props.onRestored();
      } else if (restored.status === "stale") {
        setPendingOperationId(null); setNotice("stale"); await load();
      } else setNotice("failed");
    } catch {
      if (generation === generationRef.current) setNotice("failed");
    } finally {
      if (generation === generationRef.current) setPendingOperationId(null);
      pendingRef.current = false;
    }
  };

  const cancelPurge = (): void => {
    const operationId = confirming?.trashOperationId;
    setConfirming(null); setPurgeNotice(null);
    requestAnimationFrame(() => operationId ? deleteRefs.current.get(operationId)?.focus() : sectionRef.current?.focus());
  };

  const purge = async (): Promise<void> => {
    const dataset = confirming;
    if (!dataset || !result || pendingRef.current) return;
    const generation = generationRef.current;
    pendingRef.current = true;
    setPendingOperationId(dataset.trashOperationId); setPurgeNotice(null);
    try {
      const deleted = await window.pige.collections.purgeDataset({
        apiVersion: 1,
        requestId: `collection_request_${crypto.randomUUID().replaceAll("-", "")}`,
        activeVaultId: props.activeVaultId,
        datasetId: dataset.datasetId,
        expectedRevisionId: dataset.revisionId,
        trashOperationId: dataset.trashOperationId,
        expectedTrashRevision: result.revision,
        confirmation: "delete_permanently"
      });
      if (generation !== generationRef.current) return;
      pendingRef.current = false; setPendingOperationId(null);
      if (deleted.status === "committed") {
        const remaining = result.datasets.filter((candidate) => candidate.trashOperationId !== dataset.trashOperationId);
        setResult({ ...result, datasets: remaining }); setConfirming(null); setPurgeNotice("deleted"); props.onRestored();
        focusAfterDeleteRef.current = remaining[0]?.trashOperationId ?? "section";
      } else {
        setPurgeNotice(deleted.status === "stale" ? "stale" : "failed");
        focusConfirmAfterResultRef.current = true;
      }
    } catch {
      if (generation === generationRef.current) {
        pendingRef.current = false; setPendingOperationId(null); setPurgeNotice("failed");
        focusConfirmAfterResultRef.current = true;
      }
    } finally {
      if (generation === generationRef.current && pendingRef.current) setPendingOperationId(null);
      pendingRef.current = false;
    }
  };

  return <div className="settings-inline-actions">
    <button ref={triggerRef} type="button" className="settings-button" aria-expanded={open} onClick={toggle}>
      {props.t(open ? "collection.datasetTrashClose" : "collection.datasetTrashOpen")}
    </button>
    {open ? <section ref={sectionRef} tabIndex={-1} aria-label={props.t("collection.datasetTrashTitle")}>
      <h3>{props.t("collection.datasetTrashTitle")}</h3>
      {!result && !notice ? <p role="status">{props.t("collection.datasetTrashLoading")}</p> : null}
      {result?.datasets.length === 0 ? <p>{props.t("collection.datasetTrashEmpty")}</p> : null}
      {result?.datasets.map((dataset) => <div className="settings-row" key={dataset.trashOperationId}>
        <span className="settings-row-copy"><strong>{dataset.title}</strong></span>
        <button type="button" className="settings-button" disabled={pendingOperationId !== null}
          onClick={() => void restore(dataset)}>
          {props.t(pendingOperationId === dataset.trashOperationId ? "collection.datasetRestoring" : "collection.datasetRestore")}
        </button>
        <button ref={(node) => { if (node) deleteRefs.current.set(dataset.trashOperationId, node); else deleteRefs.current.delete(dataset.trashOperationId); }}
          type="button" className="settings-button danger" disabled={pendingOperationId !== null}
          onClick={() => { setConfirming(dataset); setPurgeNotice(null); requestAnimationFrame(() => confirmRef.current?.focus()); }}>
          {props.t("collection.datasetDelete")}
        </button>
      </div>)}
      {notice ? <p className={notice === "restored" ? "settings-note" : "error"}
        role={notice === "restored" ? "status" : "alert"}>{props.t(`collection.datasetRestore_${notice}`)}</p> : null}
      {purgeNotice ? <p className={purgeNotice === "deleted" ? "settings-note" : "error"}
        role={purgeNotice === "deleted" ? "status" : "alert"}>{props.t(`collection.datasetDelete_${purgeNotice}`)}</p> : null}
      {confirming ? <div role="alertdialog" aria-modal="true" aria-labelledby="dataset-purge-title"
        aria-describedby="dataset-purge-warning">
        <h4 id="dataset-purge-title">{props.t("collection.datasetDeleteTitle")}</h4>
        <p id="dataset-purge-warning">{props.t("collection.datasetDeleteWarning")}</p>
        <button type="button" className="settings-button" disabled={pendingOperationId !== null} onClick={cancelPurge}>
          {props.t("collection.datasetDeleteCancel")}
        </button>
        <button ref={confirmRef} type="button" className="settings-button danger" disabled={pendingOperationId !== null}
          onClick={() => void purge()}>
          {props.t(pendingOperationId === confirming.trashOperationId ? "collection.datasetDeleting" : "collection.datasetDeleteConfirm")}
        </button>
      </div> : null}
    </section> : null}
  </div>;
}
