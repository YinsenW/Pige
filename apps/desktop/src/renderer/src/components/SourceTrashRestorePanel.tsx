import { useEffect, useRef, useState } from "react";
import type { SourceTrashSummary } from "@pige/contracts";

export function SourceTrashRestorePanel(props: {
  readonly activeVaultId: string | null;
  readonly onCommitted: (pageId: string) => Promise<boolean>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [sources, setSources] = useState<readonly SourceTrashSummary[]>([]), [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false), [pendingId, setPendingId] = useState<string | null>(null);
  const [reload, setReload] = useState(0), sequenceRef = useRef(0), sectionRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const sequence = ++sequenceRef.current, activeVaultId = props.activeVaultId;
    setLoaded(false); setFailed(false); setSources([]);
    if (!activeVaultId) { setLoaded(true); return; }
    const requestId = `sourcetrashlistreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    void window.pige.sources.listTrash({ apiVersion: 1, requestId, activeVaultId }).then((result) => {
      if (sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.activeVaultId !== activeVaultId || result.status !== "ready") setFailed(true);
      else setSources(result.sources);
      setLoaded(true);
    }).catch(() => { if (sequence === sequenceRef.current) { setFailed(true); setLoaded(true); } });
  }, [props.activeVaultId, reload]);
  const restore = async (source: SourceTrashSummary): Promise<void> => {
    const activeVaultId = props.activeVaultId;
    if (!activeVaultId || pendingId) return;
    const sequence = ++sequenceRef.current, requestId = `sourcetrashrestorereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    const index = sources.findIndex((item) => item.trashOperationId === source.trashOperationId);
    setPendingId(source.trashOperationId); setFailed(false);
    let focusId = source.trashOperationId;
    try {
      const result = await window.pige.sources.restoreTrash({ apiVersion: 1, requestId, activeVaultId,
        sourceId: source.sourceId, pageId: source.pageId, trashOperationId: source.trashOperationId,
        expectedTrashRevision: source.trashRevision });
      const current = await window.pige.vault.current();
      if (sequence !== sequenceRef.current || current?.vaultId !== activeVaultId || result.requestId !== requestId ||
        result.activeVaultId !== activeVaultId || result.sourceId !== source.sourceId ||
        result.trashOperationId !== source.trashOperationId || result.expectedTrashRevision !== source.trashRevision) return;
      if (result.status === "committed") {
        focusId = sources[index + 1]?.trashOperationId ?? sources[index - 1]?.trashOperationId ?? "";
        setSources((items) => items.filter((item) => item.trashOperationId !== source.trashOperationId));
        if (!await props.onCommitted(source.pageId)) setFailed(true);
      } else setFailed(true);
    } catch { if (sequence === sequenceRef.current) setFailed(true); }
    finally {
      if (sequence === sequenceRef.current) {
        setPendingId(null);
        window.requestAnimationFrame(() => (triggerRefs.current.get(focusId) ?? sectionRef.current)?.focus({ preventScroll: true }));
      }
    }
  };
  return <section ref={sectionRef} className="settings-section" aria-labelledby="activity-source-trash-title" tabIndex={-1}>
    <h2 className="settings-section-title" id="activity-source-trash-title">{props.t("activity.sourceTrash.title")}</h2>
    {!loaded ? <p className="settings-note">{props.t("activity.sourceTrash.loading")}</p>
      : failed ? <p className="settings-note" role="alert">{props.t("activity.sourceTrash.failed")}
        <button type="button" className="settings-button" onClick={() => setReload((value) => value + 1)}>{props.t("activity.sourceTrash.retry")}</button></p>
      : sources.length === 0 ? <p className="settings-note">{props.t("activity.sourceTrash.empty")}</p>
      : <div className="settings-card">{sources.map((source) => <div className="settings-row" key={source.trashOperationId}>
        <div className="settings-row-copy"><strong>{source.title}</strong><span>{props.t(source.storage === "managed_copy"
          ? "activity.sourceTrash.managed" : "activity.sourceTrash.reference")}</span></div>
        <div className="settings-row-control"><button ref={(node) => { if (node) triggerRefs.current.set(source.trashOperationId, node); else triggerRefs.current.delete(source.trashOperationId); }}
          type="button" className="settings-button" disabled={pendingId !== null}
          onClick={() => void restore(source)}>{props.t(pendingId === source.trashOperationId
            ? "activity.sourceTrash.restoring" : "activity.sourceTrash.restore")}</button></div>
      </div>)}</div>}
  </section>;
}
