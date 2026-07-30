import { useEffect, useRef, useState } from "react";
import type { ReferencedOriginalReconnectCandidate, SourceReconnectListResult, SourceReconnectRequest, SourceReconnectResult } from "@pige/contracts";
import { SourceRelinkChangedDialog } from "./SourceRelinkChangedDialog";

type ListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly result: Extract<SourceReconnectListResult, { readonly status: "ready" }> }
  | { readonly kind: "failed" };

type Notice = {
  readonly sourceId: string;
  readonly kind: "reconnected" | "stale" | "mismatch" | "failed";
};

export function ReferencedOriginalConnections(props: {
  readonly activeVaultId: string;
  readonly disabled: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const sequenceRef = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reconnected, setReconnected] = useState(false);
  const [changedPreview, setChangedPreview] = useState<{
    readonly source: ReferencedOriginalReconnectCandidate;
    readonly request: SourceReconnectRequest;
    readonly preview: Extract<SourceReconnectResult, { readonly status: "changed" }>["preview"];
  } | null>(null);

  const load = async (): Promise<void> => {
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const activeVaultId = props.activeVaultId;
    setState({ kind: "loading" });
    try {
      const request = {
        apiVersion: 1 as const,
        requestId: `sourcereconnectlist_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId
      };
      const result = await window.pige.sources.reconnectableOriginals(request);
      if (sequence !== sequenceRef.current || activeVaultId !== props.activeVaultId ||
        result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId) return;
      setState(result.status === "ready" ? { kind: "ready", result } : { kind: "failed" });
    } catch {
      if (sequence === sequenceRef.current && activeVaultId === props.activeVaultId) setState({ kind: "failed" });
    }
  };

  useEffect(() => {
    pendingRef.current = null;
    setPendingSourceId(null);
    setNotice(null);
    setReconnected(false);
    setChangedPreview(null);
    void load();
    return () => { sequenceRef.current += 1; pendingRef.current = null; };
  }, [props.activeVaultId]);

  const reconnect = async (source: ReferencedOriginalReconnectCandidate): Promise<void> => {
    if (pendingRef.current || props.disabled) return;
    pendingRef.current = source.sourceId;
    setPendingSourceId(source.sourceId);
    setNotice(null);
    setReconnected(false);
    const activeVaultId = props.activeVaultId;
    const sequence = sequenceRef.current;
    const request = {
      apiVersion: 1 as const,
      requestId: `sourcereconnectdirect_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId,
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      sourceRevision: source.sourceRevision,
      expectedAvailability: source.expectedAvailability,
      expectedChecksum: source.expectedChecksum,
      expectedSize: source.expectedSize,
      formatIdentity: source.formatIdentity
    };
    let keepDialogOpen = false;
    try {
      const result = await window.pige.sources.reconnectOriginal(request);
      if (sequence !== sequenceRef.current || activeVaultId !== props.activeVaultId ||
        !sameIdentity(request, result)) return;
      if (result.status === "cancelled") return;
      if (result.status === "changed") {
        keepDialogOpen = true;
        setChangedPreview({ source, request, preview: result.preview });
        return;
      }
      if (result.status === "reconnected") {
        setReconnected(true);
        try { await props.onRefresh(); } catch { /* durable repair remains successful */ }
        await load();
      } else {
        setNotice({
          sourceId: source.sourceId,
          kind: result.status === "mismatch" ? "mismatch" :
            result.status === "stale" || result.status === "not_found" || result.status === "ineligible"
              ? "stale"
              : "failed"
        });
      }
    } catch {
      if (sequence === sequenceRef.current && activeVaultId === props.activeVaultId) {
        setNotice({ sourceId: source.sourceId, kind: "failed" });
      }
    } finally {
      if (pendingRef.current === source.sourceId) {
        pendingRef.current = null;
        setPendingSourceId(null);
        if (!keepDialogOpen) window.requestAnimationFrame(() => triggerRefs.current.get(source.sourceId)?.focus());
      }
    }
  };

  const confirmChanged = async (): Promise<void> => {
    if (!changedPreview || pendingRef.current || props.disabled) return;
    const value = changedPreview;
    pendingRef.current = value.source.sourceId;
    setPendingSourceId(value.source.sourceId);
    const request: SourceReconnectRequest = {
      ...value.request,
      requestId: `sourcereconnectdirect_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      previewId: value.preview.previewId
    };
    try {
      const result = await window.pige.sources.reconnectOriginal(request);
      if (!sameIdentity(request, result)) return;
      setChangedPreview(null);
      if (result.status === "reconnected") {
        setReconnected(true);
        try { await props.onRefresh(); } catch { /* durable repair remains successful */ }
        await load();
      } else {
        setNotice({ sourceId: value.source.sourceId,
          kind: result.status === "stale" || result.status === "not_found" || result.status === "ineligible" ? "stale" : "failed" });
      }
    } catch {
      setChangedPreview(null);
      setNotice({ sourceId: value.source.sourceId, kind: "failed" });
    } finally {
      pendingRef.current = null;
      setPendingSourceId(null);
      window.requestAnimationFrame(() => triggerRefs.current.get(value.source.sourceId)?.focus());
    }
  };

  return (
    <div className="settings-row tall" aria-busy={state.kind === "loading" || pendingSourceId !== null}>
      <div className="settings-row-copy">
        <strong>{props.t("sourceReconnect.title")}</strong>
        <span>{props.t("sourceReconnect.description")}</span>
        {state.kind === "loading" ? <span role="status">{props.t("sourceReconnect.loading")}</span>
          : state.kind === "failed" ? <span role="alert">{props.t("sourceReconnect.failed")}</span>
            : state.result.sources.length === 0 ? <span>{props.t("sourceReconnect.allConnected")}</span>
              : <ul className="settings-compact-list">
                {state.result.sources.map((source) => (
                  <li key={source.sourceId}>
                    <span>{source.displayName}</span>
                    <button
                      ref={(element) => {
                        if (element) triggerRefs.current.set(source.sourceId, element);
                        else triggerRefs.current.delete(source.sourceId);
                      }}
                      className="settings-button"
                      type="button"
                      disabled={props.disabled || pendingSourceId !== null}
                      aria-busy={pendingSourceId === source.sourceId || undefined}
                      onClick={() => void reconnect(source)}
                    >{props.t(pendingSourceId === source.sourceId
                        ? "sourceReconnect.reconnecting"
                        : "sourceReconnect.action")}</button>
                    {notice?.sourceId === source.sourceId ? <span role={notice.kind === "failed" ? "alert" : "status"}>
                      {props.t(`sourceReconnect.${notice.kind}`)}
                    </span> : null}
                  </li>
                ))}
                {state.result.truncated ? <li>{props.t("sourceReconnect.truncated")}</li> : null}
              </ul>}
        {reconnected ? <span role="status">{props.t("sourceReconnect.reconnected")}</span> : null}
      </div>
      <button className="settings-button" type="button" disabled={props.disabled || pendingSourceId !== null}
        onClick={() => void load()}>{props.t("sourceReconnect.refresh")}</button>
      {changedPreview ? <SourceRelinkChangedDialog preview={changedPreview.preview}
        pending={pendingSourceId !== null} t={props.t}
        onCancel={() => {
          const sourceId = changedPreview.source.sourceId;
          setChangedPreview(null);
          window.requestAnimationFrame(() => triggerRefs.current.get(sourceId)?.focus());
        }} onConfirm={() => void confirmChanged()} /> : null}
    </div>
  );
}

function sameIdentity(
  request: Parameters<typeof window.pige.sources.reconnectOriginal>[0],
  result: Awaited<ReturnType<typeof window.pige.sources.reconnectOriginal>>
): boolean {
  return result.apiVersion === request.apiVersion && result.requestId === request.requestId &&
    result.activeVaultId === request.activeVaultId && result.sourceId === request.sourceId &&
    result.sourceKind === request.sourceKind && result.sourceRevision === request.sourceRevision &&
    result.expectedAvailability === request.expectedAvailability &&
    result.expectedChecksum === request.expectedChecksum && result.expectedSize === request.expectedSize &&
    result.formatIdentity === request.formatIdentity;
}
