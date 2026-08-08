import { useCallback, useEffect, useRef, useState } from "react";
import type { RestorePreviewResult, RestoreRollbackCandidate } from "@pige/contracts";

export function BackupRestoreRollbackAction(props: {
  readonly activeVaultId: string;
  readonly disabled: boolean;
  readonly restoreIdle: boolean;
  readonly onPreview: (loadPreview: () => Promise<RestorePreviewResult>) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [candidate, setCandidate] = useState<RestoreRollbackCandidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"failed" | "stale" | "not_found" | null>(null);
  const sequenceRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);

  const loadStatus = useCallback(async (): Promise<void> => {
    const sequence = ++sequenceRef.current;
    const status = window.pige.backup.rollbackRestoreStatus;
    if (!status) {
      setNotice("failed");
      return;
    }
    try {
      const result = await status();
      if (sequence !== sequenceRef.current) return;
      if (result.status === "ready" && result.candidate.activeVaultId === props.activeVaultId) {
        setCandidate(result.candidate);
        setNotice(null);
      } else {
        setCandidate(null);
        setNotice(null);
      }
    } catch {
      if (sequence === sequenceRef.current) setNotice("failed");
    }
  }, [props.activeVaultId]);

  useEffect(() => {
    setCandidate(null);
    setNotice(null);
    void loadStatus();
    return () => { sequenceRef.current += 1; };
  }, [loadStatus]);

  const prepare = async (): Promise<void> => {
    const request = window.pige.backup.prepareRollbackRestore;
    if (!request || !candidate || props.disabled || busy || !props.restoreIdle) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await request({
        apiVersion: 1,
        requestId: `restorerollbackreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        ...candidate
      });
      if (result.status !== "prepared") {
        setNotice(result.status);
        return;
      }
      try {
        await props.onPreview(async () => result.preview);
      } catch {
        setNotice("failed");
      }
    } catch {
      setNotice("failed");
    } finally {
      setBusy(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };

  if (!candidate && !notice) return null;
  return <div className="settings-row" aria-busy={busy || undefined}><div className="settings-row-copy">
    <strong>{props.t("backup.restorePrevious")}</strong>
    <span>{props.t("backup.restorePreviousDescription")}</span>
    {notice ? <span className="settings-inline-status error" role="alert" aria-live="polite">
      {props.t("backup.failedRetryable")}
    </span> : null}
  </div><div className="settings-row-control">
    {candidate ? <button ref={triggerRef} className="settings-button" type="button" disabled={props.disabled || busy || !props.restoreIdle}
      aria-busy={busy || undefined} onClick={() => void prepare()}>{props.t(busy ? "backup.opening" : "backup.restorePrevious")}</button> : null}
    {notice ? <button ref={retryRef} className="settings-button" type="button" disabled={props.disabled || busy}
      aria-busy={busy || undefined} onClick={() => void (candidate ? prepare() : loadStatus())}>{props.t("confirmation.retry")}</button> : null}
  </div></div>;
}
