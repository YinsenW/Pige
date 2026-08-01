import { useEffect, useRef, useState } from "react";
import type { BackupConversationPreferenceSummary } from "@pige/schemas";

export function BackupConversationPreferenceControl(props: {
  readonly activeVaultId: string;
  readonly disabled: boolean;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [summary, setSummary] = useState<BackupConversationPreferenceSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    setSummary(null);
    setPending(false);
    setNoticeKey(null);
    void window.pige.backup.conversationPreferenceStatus().then((next) => {
      if (sequence === sequenceRef.current && next.activeVaultId === props.activeVaultId) setSummary(next);
    }).catch(() => {
      if (sequence === sequenceRef.current) setNoticeKey("backup.conversationPreferenceFailed");
    });
    return () => { sequenceRef.current += 1; };
  }, [props.activeVaultId]);

  const toggle = async (): Promise<void> => {
    if (!summary || pending || props.disabled || !summary.canUpdate) return;
    const sequence = ++sequenceRef.current;
    setPending(true);
    setNoticeKey(null);
    try {
      const result = await window.pige.backup.setConversationPreference({
        apiVersion: 1,
        requestId: `backupconversationreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: props.activeVaultId,
        expectedRevision: summary.revision,
        includeConversations: !summary.includeConversations
      });
      if (sequence !== sequenceRef.current || result.activeVaultId !== props.activeVaultId) return;
      setSummary(result.summary);
      setNoticeKey(result.status === "updated"
        ? "backup.conversationPreferenceUpdated"
        : result.status === "blocked"
          ? "backup.conversationPreferenceBlocked"
          : "backup.conversationPreferenceStale");
    } catch {
      if (sequence === sequenceRef.current) setNoticeKey("backup.conversationPreferenceFailed");
    } finally {
      if (sequence === sequenceRef.current) {
        setPending(false);
        buttonRef.current?.focus();
      }
    }
  };

  return <div className="settings-row">
    <div className="settings-row-copy">
      <strong>{props.t("backup.conversationPreferenceTitle")}</strong>
      <span>{props.t("backup.conversationPreferenceDescription")}</span>
      {noticeKey ? <span role={noticeKey.endsWith("Failed") ? "alert" : "status"} aria-live="polite">{props.t(noticeKey)}</span> : null}
    </div>
    <button ref={buttonRef} className="settings-button" type="button" role="switch"
      aria-checked={summary?.includeConversations ?? true}
      aria-label={props.t("backup.conversationPreferenceTitle")}
      disabled={props.disabled || pending || !summary?.canUpdate}
      onClick={() => void toggle()}>
      {summary ? props.t(summary.includeConversations ? "backup.conversationPreferenceInclude" : "backup.conversationPreferenceExclude") : props.t("backup.loading")}
    </button>
  </div>;
}
