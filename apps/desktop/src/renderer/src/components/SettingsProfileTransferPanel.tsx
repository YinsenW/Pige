import { useRef, useState } from "react";
import type {
  SettingsProfileExportRequest,
  SettingsProfileExportResult,
  SettingsProfileImportApplyRequest,
  SettingsProfileImportApplyResult,
  SettingsProfileImportPreviewRequest,
  SettingsProfileImportPreviewResult
} from "@pige/contracts";

export interface SettingsProfileTransferApi {
  readonly exportProfile: (request: SettingsProfileExportRequest) => Promise<SettingsProfileExportResult>;
  readonly previewImport: (
    request: SettingsProfileImportPreviewRequest
  ) => Promise<SettingsProfileImportPreviewResult>;
  readonly applyImport: (
    request: SettingsProfileImportApplyRequest
  ) => Promise<SettingsProfileImportApplyResult>;
}

export function SettingsProfileTransferPanel(props: {
  readonly api: SettingsProfileTransferApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Extract<SettingsProfileImportPreviewResult, { status: "ready" }> | null>(null);
  const [notice, setNotice] = useState<"exported" | "committed" | "stale" | "failed" | null>(null);
  const busyRef = useRef(false);
  const importButtonRef = useRef<HTMLButtonElement>(null);

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try { await action(); } catch { setNotice("failed"); }
    finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const exportProfile = (): void => { void run(async () => {
    const result = await props.api.exportProfile({ apiVersion: 1, requestId: requestId() });
    if (result.status === "exported") setNotice("exported");
    else if (result.status === "failed") setNotice("failed");
  }); };

  const previewImport = (): void => { void run(async () => {
    const result = await props.api.previewImport({ apiVersion: 1, requestId: requestId() });
    if (result.status === "ready") setPreview(result);
    else if (result.status === "failed") setNotice("failed");
  }); };

  const applyImport = (): void => { if (!preview) return; void run(async () => {
    const result = await props.api.applyImport({
      apiVersion: 1,
      requestId: requestId(),
      previewId: preview.previewId
    });
    if (result.status === "committed") {
      setPreview(null);
      setNotice("committed");
      importButtonRef.current?.focus({ preventScroll: true });
    } else if (result.status === "stale" || result.status === "not_found") {
      setPreview(null);
      setNotice("stale");
      importButtonRef.current?.focus({ preventScroll: true });
    } else if (result.status === "failed") {
      setNotice("failed");
    }
  }); };

  return <section className="settings-section" aria-labelledby="settings-profile-transfer-title">
    <h2 className="settings-section-title" id="settings-profile-transfer-title">
      {props.t("settings.general.profileTransferTitle")}
    </h2>
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{props.t("settings.general.profileTransferExportTitle")}</strong>
          <span>{props.t("settings.general.profileTransferDescription")}</span>
        </div>
        <button className="settings-button" type="button" disabled={busy} onClick={exportProfile}>
          {props.t("settings.general.profileTransferExport")}
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{props.t("settings.general.profileTransferImportTitle")}</strong>
          <span>{props.t("settings.general.profileTransferExclusions")}</span>
          {notice ? <span role="status" aria-live="polite">
            {props.t(`settings.general.profileTransfer${capitalize(notice)}`)}
          </span> : null}
          {preview ? <span role="status" aria-live="polite">
            {props.t("settings.general.profileTransferPreviewReady")}
          </span> : null}
        </div>
        <div className="settings-actions">
          {preview ? <>
            <button className="settings-button" type="button" disabled={busy} onClick={() => setPreview(null)}>
              {props.t("settings.general.profileTransferCancel")}
            </button>
            <button className="settings-button settings-button-primary" type="button" disabled={busy} onClick={applyImport}>
              {props.t("settings.general.profileTransferApply")}
            </button>
          </> : <button
            ref={importButtonRef}
            className="settings-button"
            type="button"
            disabled={busy}
            onClick={previewImport}
          >
            {props.t("settings.general.profileTransferImport")}
          </button>}
        </div>
      </div>
    </div>
  </section>;
}

function requestId(): string {
  return `settingsprofilereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function capitalize(value: string): string {
  return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
