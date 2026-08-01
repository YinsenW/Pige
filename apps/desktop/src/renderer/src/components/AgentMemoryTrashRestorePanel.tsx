import { useEffect, useRef, useState } from "react";
import type { MemorySummary, MemoryTrashRecordSummary, MemoryTrashSummary } from "@pige/schemas";

type Translate = (key: string) => string;

export function AgentMemoryTrashRestorePanel(props: {
  readonly activeVaultId: string;
  readonly revision: number;
  readonly disabled: boolean;
  readonly onCommitted: (summary: MemorySummary) => void;
  readonly t: Translate;
}): React.JSX.Element {
  const [trash, setTrash] = useState<MemoryTrashSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const restoreRefs = useRef(new Map<string, HTMLButtonElement>());
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => setStatusKey(null), [props.activeVaultId]);

  useEffect(() => {
    const activeVaultId = props.activeVaultId;
    let current = true;
    setState("loading");
    const listTrash = window.pige.memory?.listTrash;
    if (!listTrash) {
      setState("failed");
      return () => { current = false; };
    }
    void listTrash({ apiVersion: 1, activeVaultId }).then((next) => {
      if (!current || activeVaultIdRef.current !== activeVaultId || next.activeVaultId !== activeVaultId) return;
      setTrash(next);
      setState("ready");
    }).catch(() => {
      if (current && activeVaultIdRef.current === activeVaultId) setState("failed");
    });
    return () => { current = false; };
  }, [props.activeVaultId, props.revision, reload]);

  const restore = async (record: MemoryTrashRecordSummary): Promise<void> => {
    const current = trash;
    const restoreTrash = window.pige.memory?.restoreTrash;
    if (!current || restoringId || props.disabled || !restoreTrash) return;
    const activeVaultId = current.activeVaultId;
    setRestoringId(record.memoryId);
    setStatusKey(null);
    try {
      const result = await restoreTrash({
        apiVersion: 1,
        requestId: `memory_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId,
        memoryId: record.memoryId,
        trashOperationId: record.trashOperationId,
        expectedRevision: current.revision
      });
      if (activeVaultIdRef.current !== activeVaultId || result.activeVaultId !== activeVaultId) return;
      setTrash(result.trash);
      props.onCommitted(result.summary);
      setStatusKey(result.status === "committed"
        ? "memory.trashRestoreCompleted"
        : result.status === "stale"
          ? "memory.trashRestoreStale"
          : "memory.trashRestoreNotFound");
      window.setTimeout(() => restoreRefs.current.get(record.memoryId)?.focus(), 0);
    } catch {
      if (activeVaultIdRef.current === activeVaultId) setStatusKey("memory.trashRestoreFailed");
    } finally {
      if (activeVaultIdRef.current === activeVaultId) setRestoringId(null);
    }
  };

  return (
    <div className="settings-card" aria-labelledby="memory-trash-title" data-memory-trash-revision={trash?.revision}>
      <div className="settings-row-copy">
        <strong id="memory-trash-title">{props.t("memory.trashTitle")}</strong>
        <span>{props.t("memory.trashDescription")}</span>
      </div>
      {state === "loading" ? <span role="status">{props.t("memory.trashLoading")}</span> : null}
      {state === "failed" ? (
        <div className="settings-inline-actions" role="alert">
          <span>{props.t("memory.trashLoadFailed")}</span>
          <button className="settings-button" type="button" onClick={() => setReload((value) => value + 1)}>
            {props.t("memory.retryLoad")}
          </button>
        </div>
      ) : null}
      {state === "ready" && trash?.records.length === 0 ? <span>{props.t("memory.trashEmpty")}</span> : null}
      {state === "ready" ? trash?.records.map((record) => (
        <div className="settings-row tall" data-memory-trash-id={record.memoryId} key={record.trashOperationId}>
          <div className="settings-row-copy">
            <strong>{record.title}</strong>
            <span>{props.t(`memory.kind.${record.kind}`)}</span>
            <time dateTime={record.trashedAt}>{record.trashedAt}</time>
          </div>
          <button
            ref={(node) => {
              if (node) restoreRefs.current.set(record.memoryId, node);
              else restoreRefs.current.delete(record.memoryId);
            }}
            className="settings-button"
            type="button"
            disabled={props.disabled || restoringId !== null}
            aria-label={`${props.t("memory.trashRestore")}: ${record.title}`}
            onClick={() => void restore(record)}
          >
            {restoringId === record.memoryId ? props.t("memory.trashRestoring") : props.t("memory.trashRestore")}
          </button>
        </div>
      )) : null}
      {statusKey ? <span role="status" aria-live="polite">{props.t(statusKey)}</span> : null}
    </div>
  );
}
