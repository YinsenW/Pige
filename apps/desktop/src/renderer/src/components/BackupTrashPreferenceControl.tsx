import { useEffect, useRef, useState } from "react";
import type { BackupTrashPreferenceSummary } from "@pige/schemas";

export function BackupTrashPreferenceControl(props: {
  readonly activeVaultId: string;
  readonly disabled: boolean;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [summary, setSummary] = useState<BackupTrashPreferenceSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    setSummary(null);
    setPending(false);
    setNoticeKey(null);
    void window.pige.backup.trashPreferenceStatus().then((next) => {
      if (sequence === sequenceRef.current && next.activeVaultId === props.activeVaultId) setSummary(next);
    }).catch(() => {
      if (sequence === sequenceRef.current) setNoticeKey("backup.trashPreferenceFailed");
    });
    return () => { sequenceRef.current += 1; };
  }, [props.activeVaultId]);

  const toggle = async (): Promise<void> => {
    if (!summary || pending || props.disabled || !summary.canUpdate) return;
    const sequence = ++sequenceRef.current;
    setPending(true);
    setNoticeKey(null);
    try {
      const result = await window.pige.backup.setTrashPreference({
        apiVersion: 1,
        requestId: `backuptrashreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: props.activeVaultId,
        expectedRevision: summary.revision,
        includeTrash: !summary.includeTrash
      });
      if (sequence !== sequenceRef.current || result.activeVaultId !== props.activeVaultId) return;
      setSummary(result.summary);
      setNoticeKey(result.status === "updated"
        ? "backup.trashPreferenceUpdated"
        : result.status === "blocked"
          ? "backup.trashPreferenceBlocked"
          : "backup.trashPreferenceStale");
    } catch {
      if (sequence === sequenceRef.current) setNoticeKey("backup.trashPreferenceFailed");
    } finally {
      if (sequence === sequenceRef.current) {
        setPending(false);
        buttonRef.current?.focus();
      }
    }
  };

  return <div className="settings-row">
    <div className="settings-row-copy">
      <strong>{props.t("backup.trashPreferenceTitle")}</strong>
      <span>{props.t("backup.trashPreferenceDescription")}</span>
      {noticeKey ? <span role={noticeKey.endsWith("Failed") ? "alert" : "status"} aria-live="polite">{props.t(noticeKey)}</span> : null}
    </div>
    <button ref={buttonRef} className="settings-button" type="button" role="switch"
      aria-checked={summary?.includeTrash ?? true}
      aria-label={props.t("backup.trashPreferenceTitle")}
      disabled={props.disabled || pending || !summary?.canUpdate}
      onClick={() => void toggle()}>
      {summary ? props.t(summary.includeTrash ? "backup.trashPreferenceInclude" : "backup.trashPreferenceExclude") : props.t("backup.loading")}
    </button>
  </div>;
}
