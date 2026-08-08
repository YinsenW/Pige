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
  const trashHeadingRef = useRef<HTMLElement>(null);
  const restoreFocusOperationRef = useRef<string | null>(null);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => setStatusKey(null), [props.activeVaultId]);

  useEffect(() => {
    const operationId = restoreFocusOperationRef.current;
    if (!operationId) return;
    restoreFocusOperationRef.current = null;
    const trigger = restoreRefs.current.get(operationId);
    (trigger?.isConnected ? trigger : trashHeadingRef.current)?.focus({ preventScroll: true });
  }, [trash]);

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

  const restore = async (record: Pick<MemoryTrashRecordSummary, "trashOperationId"> & { readonly memoryId?: string }): Promise<void> => {
    const current = trash;
    const restoreTrash = window.pige.memory?.restoreTrash;
    if (!current || restoringId || props.disabled || !restoreTrash) return;
    const activeVaultId = current.activeVaultId;
    setRestoringId(record.trashOperationId);
    setStatusKey(null);
    try {
      const result = await restoreTrash({
        apiVersion: 1,
        requestId: `memory_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId,
        ...(record.memoryId ? { memoryId: record.memoryId } : {}),
        trashOperationId: record.trashOperationId,
        expectedRevision: current.revision
      });
      if (activeVaultIdRef.current !== activeVaultId || result.activeVaultId !== activeVaultId) return;
      restoreFocusOperationRef.current = record.trashOperationId;
      setTrash(result.trash);
      if (result.status === "committed") props.onCommitted(result.summary);
      setStatusKey(result.status === "committed"
        ? "memory.trashRestoreCompleted"
        : result.status === "stale"
          ? "memory.trashRestoreStale"
          : "memory.trashRestoreNotFound");
    } catch {
      if (activeVaultIdRef.current === activeVaultId) setStatusKey("memory.trashRestoreFailed");
    } finally {
      if (activeVaultIdRef.current === activeVaultId) setRestoringId(null);
    }
  };

  return (
    <div className="settings-card" aria-labelledby="memory-trash-title" data-memory-trash-revision={trash?.revision}>
      <div className="settings-row-copy">
        <strong ref={trashHeadingRef} id="memory-trash-title" tabIndex={-1}>{props.t("memory.trashTitle")}</strong>
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
      {state === "ready" && trash?.records.length === 0 && trash.resets.length === 0
        ? <span>{props.t("memory.trashEmpty")}</span> : null}
      {state === "ready" ? trash?.records.map((record) => (
        <div className="settings-row tall" data-memory-trash-id={record.memoryId} key={record.trashOperationId}>
          <div className="settings-row-copy">
            <strong>{record.title}</strong>
            <span>{props.t(`memory.kind.${record.kind}`)}</span>
            <time dateTime={record.trashedAt}>{record.trashedAt}</time>
          </div>
          <button
            ref={(node) => {
              if (node) restoreRefs.current.set(record.trashOperationId, node);
              else restoreRefs.current.delete(record.trashOperationId);
            }}
            className="settings-button"
            type="button"
            disabled={props.disabled || restoringId !== null}
            aria-label={`${props.t("memory.trashRestore")}: ${record.title}`}
            onClick={() => void restore(record)}
          >
            {restoringId === record.trashOperationId ? props.t("memory.trashRestoring") : props.t("memory.trashRestore")}
          </button>
        </div>
      )) : null}
      {state === "ready" ? trash?.resets.map((reset) => (
        <div className="settings-row tall" data-memory-trash-reset={reset.trashOperationId} key={reset.trashOperationId}>
          <div className="settings-row-copy">
            <strong>{props.t("memory.trashResetTitle")}</strong>
            <span>{reset.itemCount} {props.t("memory.trashResetItems")}</span>
            <time dateTime={reset.trashedAt}>{reset.trashedAt}</time>
          </div>
          <button
            ref={(node) => {
              if (node) restoreRefs.current.set(reset.trashOperationId, node);
              else restoreRefs.current.delete(reset.trashOperationId);
            }}
            className="settings-button"
            type="button"
            disabled={props.disabled || restoringId !== null}
            onClick={() => void restore(reset)}
          >
            {restoringId === reset.trashOperationId
              ? props.t("memory.trashRestoring") : props.t("memory.trashRestoreReset")}
          </button>
        </div>
      )) : null}
      {statusKey ? <span role="status" aria-live="polite">{props.t(statusKey)}</span> : null}
    </div>
  );
}
