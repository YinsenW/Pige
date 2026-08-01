import { useRef, useState } from "react";

export function ManualUpdateDownloadAction(props: {
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"opened" | "failed" | null>(null);
  const activeRef = useRef(false), requestRef = useRef<string | null>(null), triggerRef = useRef<HTMLButtonElement>(null);

  const open = async (): Promise<void> => {
    if (activeRef.current) return;
    const requestId = `updatemanualreq_${crypto.randomUUID().replaceAll("-", "")}`;
    activeRef.current = true; requestRef.current = requestId; setPending(true); setNotice(null);
    try {
      const result = await window.pige.updates.openManualDownload({ apiVersion: 1, requestId });
      if (requestRef.current !== requestId || result.requestId !== requestId) return;
      setNotice(result.status === "opened" ? "opened" : "failed");
    } catch {
      if (requestRef.current === requestId) setNotice("failed");
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null; activeRef.current = false; setPending(false);
        window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
      }
    }
  };

  return <div className="settings-row">
    <div className="settings-row-copy">
      <strong>{props.t("system.manualDownload")}</strong>
      <span id="system-manual-download-description">{props.t("system.manualDownloadDescription")}</span>
      {notice ? <span id="system-manual-download-notice" role={notice === "failed" ? "alert" : "status"}
        aria-live="polite">{props.t(`system.manualDownload.${notice}`)}</span> : null}
    </div>
    <button ref={triggerRef} className="settings-button" type="button" disabled={pending}
      aria-describedby={`system-manual-download-description${notice ? " system-manual-download-notice" : ""}`}
      onClick={() => void open()}>{props.t(pending ? "system.manualDownload.opening" : "system.manualDownload.open")}</button>
  </div>;
}
