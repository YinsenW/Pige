import { useEffect, useRef, useState } from "react";

export interface VaultStorageRelocationLabels {
  readonly action: string;
  readonly pending: string;
  readonly relocated: string;
  readonly stale: string;
  readonly blocked: string;
  readonly destinationExists: string;
  readonly failed: string;
}

export function VaultStorageRelocationAction(props: {
  readonly activeVaultId: string;
  readonly disabled: boolean;
  readonly labels: VaultStorageRelocationLabels;
  readonly onRelocated: () => Promise<void>;
  readonly onPendingChange?: (pending: boolean) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string } | null>(null);
  const sequenceRef = useRef(0);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const triggerRef = useRef<HTMLButtonElement>(null);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    sequenceRef.current += 1;
    setPending(false);
    setNotice(null);
  }, [props.activeVaultId]);
  useEffect(() => () => { sequenceRef.current += 1; }, []);

  const relocate = async (): Promise<void> => {
    if (props.disabled || pending) return;
    const sequence = ++sequenceRef.current;
    const activeVaultId = props.activeVaultId;
    setPending(true);
    setNotice(null);
    props.onPendingChange?.(true);
    try {
      const status = await window.pige.vault.storageRelocationStatus();
      if (sequence !== sequenceRef.current || activeVaultIdRef.current !== activeVaultId) return;
      if (status.status !== "ready" || status.activeVaultId !== activeVaultId) {
        setNotice({ kind: "error", text: props.labels.stale });
        return;
      }
      const result = await window.pige.vault.relocateStorage({
        apiVersion: 1,
        requestId: `vaultrelocatereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId,
        expectedRevision: status.revision
      });
      if (sequence !== sequenceRef.current || activeVaultIdRef.current !== activeVaultId) return;
      if (result.status === "relocated") {
        setNotice({ kind: "status", text: props.labels.relocated });
        try {
          await props.onRelocated();
        } catch {
          // The durable relocation already committed. A best-effort summary refresh
          // must not rewrite that authoritative success as a relocation failure.
        }
      } else if (result.status === "cancelled") {
        setNotice(null);
      } else if (result.status === "stale") {
        setNotice({ kind: "error", text: props.labels.stale });
      } else if (result.status === "blocked_active_work") {
        setNotice({ kind: "error", text: props.labels.blocked });
      } else if (result.status === "destination_exists") {
        setNotice({ kind: "error", text: props.labels.destinationExists });
      } else {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } catch {
      if (sequence === sequenceRef.current && activeVaultIdRef.current === activeVaultId) {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } finally {
      if (sequence === sequenceRef.current && activeVaultIdRef.current === activeVaultId) {
        setPending(false);
        props.onPendingChange?.(false);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => triggerRef.current?.focus()));
      }
    }
  };

  return <div className="settings-row-control">
    <button ref={triggerRef} className="settings-button" type="button"
      disabled={props.disabled || pending} aria-busy={pending || undefined}
      onClick={() => void relocate()}>{pending ? props.labels.pending : props.labels.action}</button>
    {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
      role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</span> : null}
  </div>;
}
