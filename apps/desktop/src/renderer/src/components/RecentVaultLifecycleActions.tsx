import { useEffect, useRef, useState, type RefObject } from "react";
import type { RecentVaultSummary } from "@pige/contracts";

type RecentVaultAction = "forget" | "reconnect";

export interface RecentVaultLifecycleLabels {
  readonly active: string;
  readonly forget: string;
  readonly forgetting: string;
  readonly reconnect: string;
  readonly reconnecting: string;
  readonly reconnected: string;
  readonly stale: string;
  readonly activeBlocked: string;
  readonly mismatch: string;
  readonly failed: string;
}

export interface RecentVaultLifecycleActionsProps {
  readonly recent: RecentVaultSummary;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly labels: RecentVaultLifecycleLabels;
  readonly onRecentVaultsChanged: (recentVaults: readonly RecentVaultSummary[]) => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

export function RecentVaultLifecycleActions(props: RecentVaultLifecycleActionsProps): React.JSX.Element {
  const [pending, setPending] = useState<RecentVaultAction | null>(null);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string } | null>(null);
  const sequenceRef = useRef(0);
  const vaultIdRef = useRef(props.recent.vaultId);
  const forgetRef = useRef<HTMLButtonElement>(null);
  const reconnectRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (vaultIdRef.current === props.recent.vaultId) return;
    vaultIdRef.current = props.recent.vaultId;
    sequenceRef.current += 1;
    setPending(null);
    setNotice(null);
  }, [props.recent.vaultId]);
  useEffect(() => () => { sequenceRef.current += 1; }, []);

  if (props.active) return <span className="settings-status">{props.labels.active}</span>;

  const refresh = async (): Promise<void> => {
    props.onRecentVaultsChanged(await window.pige.vault.recent());
  };

  const run = async (action: RecentVaultAction): Promise<void> => {
    if (pending || props.disabled) return;
    const sequence = ++sequenceRef.current;
    const vaultId = props.recent.vaultId;
    const expectedRevision = props.recent.revision;
    const requestId = action === "forget"
      ? `recentvaultforgetreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
      : `recentvaultreconnectreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    setPending(action);
    setNotice(null);
    try {
      const result = action === "forget"
        ? await window.pige.vault.forgetRecent({ apiVersion: 1, requestId, vaultId, expectedRevision })
        : await window.pige.vault.reconnectRecent({ apiVersion: 1, requestId, vaultId, expectedRevision });
      if (sequence !== sequenceRef.current || vaultIdRef.current !== vaultId) return;
      if (result.status === "forgotten") {
        await refresh();
      } else if (result.status === "reconnected") {
        await refresh();
        setNotice({ kind: "status", text: props.labels.reconnected });
      } else if (result.status === "cancelled") {
        setNotice(null);
      } else if (result.status === "stale" || result.status === "not_found") {
        await refresh().catch(() => undefined);
        setNotice({ kind: "error", text: props.labels.stale });
      } else if (result.status === "active") {
        setNotice({ kind: "error", text: props.labels.activeBlocked });
      } else if (result.status === "mismatch") {
        setNotice({ kind: "error", text: props.labels.mismatch });
      } else {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } catch {
      if (sequence === sequenceRef.current && vaultIdRef.current === vaultId) {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } finally {
      if (sequence === sequenceRef.current && vaultIdRef.current === vaultId) {
        setPending(null);
        const trigger = action === "forget" ? forgetRef : reconnectRef;
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          (trigger.current?.isConnected ? trigger.current : props.returnFocusRef.current)?.focus();
        }));
      }
    }
  };

  return <>
    <button ref={reconnectRef} className="settings-button" type="button"
      aria-label={`${props.labels.reconnect}: ${props.recent.name}`}
      aria-busy={pending === "reconnect" || undefined} disabled={props.disabled || pending !== null}
      onClick={() => void run("reconnect")}>{pending === "reconnect" ? props.labels.reconnecting : props.labels.reconnect}</button>
    <button ref={forgetRef} className="settings-button" type="button"
      aria-label={`${props.labels.forget}: ${props.recent.name}`}
      aria-busy={pending === "forget" || undefined} disabled={props.disabled || pending !== null}
      onClick={() => void run("forget")}>{pending === "forget" ? props.labels.forgetting : props.labels.forget}</button>
    {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
      role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</span> : null}
  </>;
}
