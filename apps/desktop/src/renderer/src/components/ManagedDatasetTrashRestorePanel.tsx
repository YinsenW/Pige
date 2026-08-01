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
  const generationRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    setOpen(false); setResult(null); setPendingOperationId(null); setNotice(null);
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
      generationRef.current += 1; setOpen(false); setResult(null); setNotice(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    setOpen(true); void load();
    requestAnimationFrame(() => sectionRef.current?.focus());
  };

  const restore = async (dataset: CollectionDatasetTrashSummary): Promise<void> => {
    if (!result || pendingOperationId) return;
    const generation = generationRef.current;
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
      </div>)}
      {notice ? <p className={notice === "restored" ? "settings-note" : "error"}
        role={notice === "restored" ? "status" : "alert"}>{props.t(`collection.datasetRestore_${notice}`)}</p> : null}
    </section> : null}
  </div>;
}
