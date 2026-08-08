import { useEffect, useState } from "react";
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

  useEffect(() => {
    const status = window.pige.backup.rollbackRestoreStatus;
    if (!status) {
      setCandidate(null);
      return;
    }
    let active = true;
    void status().then((result) => {
      if (!active) return;
      setCandidate(result.status === "ready" && result.candidate.activeVaultId === props.activeVaultId
        ? result.candidate
        : null);
    }).catch(() => {
      if (active) setCandidate(null);
    });
    return () => { active = false; };
  }, [props.activeVaultId]);

  const prepare = async (): Promise<void> => {
    const request = window.pige.backup.prepareRollbackRestore;
    if (!request || !candidate || props.disabled || busy || !props.restoreIdle) return;
    setBusy(true);
    try {
      const result = await request({
        apiVersion: 1,
        requestId: `restorerollbackreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        ...candidate
      });
      if (result.status !== "prepared") {
        if (result.status === "stale" || result.status === "not_found") setCandidate(null);
        return;
      }
      await props.onPreview(async () => result.preview);
    } catch {
      setCandidate(null);
    } finally {
      setBusy(false);
    }
  };

  if (!candidate) return null;
  return <div className="settings-row"><div className="settings-row-copy">
    <strong>{props.t("backup.restorePrevious")}</strong>
    <span>{props.t("backup.restorePreviousDescription")}</span>
  </div><button className="settings-button" type="button" disabled={props.disabled || busy || !props.restoreIdle}
    onClick={() => void prepare()}>{props.t(busy ? "backup.opening" : "backup.restorePrevious")}</button></div>;
}
