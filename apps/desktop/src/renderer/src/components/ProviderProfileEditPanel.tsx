import { useEffect, useRef, useState } from "react";
import type { ModelProviderSettingsSummary, UpdateProviderProfileRequest } from "@pige/contracts";
import type { CloudBoundary } from "@pige/schemas";

type Provider = ModelProviderSettingsSummary["providers"][number];

export function ProviderProfileEditPanel(props: {
  readonly provider: Provider;
  readonly expectedRevision: string | undefined;
  readonly busy: boolean;
  readonly onBusy: (busy: boolean) => void;
  readonly onRefresh: () => Promise<ModelProviderSettingsSummary | null>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(props.provider.displayName);
  const [baseUrl, setBaseUrl] = useState(props.provider.baseUrl ?? "");
  const [boundary, setBoundary] = useState<Exclude<CloudBoundary, "local">>(editableBoundary(props.provider.cloudBoundary));
  const [notice, setNotice] = useState<"saved" | "failed" | null>(null);
  const pendingRef = useRef(false), sequenceRef = useRef(0), ownerRef = useRef(props.provider.id);
  const triggerRef = useRef<HTMLButtonElement>(null), firstFieldRef = useRef<HTMLInputElement>(null), restoreFocusRef = useRef(false);
  ownerRef.current = props.provider.id;

  useEffect(() => {
    sequenceRef.current += 1; pendingRef.current = false; setEditing(false); setNotice(null);
    setDisplayName(props.provider.displayName); setBaseUrl(props.provider.baseUrl ?? "");
    setBoundary(editableBoundary(props.provider.cloudBoundary));
  }, [props.provider.id]);
  useEffect(() => {
    if (!editing && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  }, [editing]);

  if (props.provider.presetId || !props.provider.baseUrl) return null;

  const close = (): void => {
    if (pendingRef.current) return;
    restoreFocusRef.current = true; setEditing(false); setNotice(null); setDisplayName(props.provider.displayName);
    setBaseUrl(props.provider.baseUrl ?? ""); setBoundary(editableBoundary(props.provider.cloudBoundary));
  };
  const save = async (): Promise<void> => {
    const expectedRevision = props.expectedRevision;
    const name = displayName.trim(), endpoint = baseUrl.trim();
    if (!expectedRevision || !name || !endpoint || pendingRef.current) return;
    const request: UpdateProviderProfileRequest = { providerProfileId: props.provider.id, expectedRevision,
      displayName: name, baseUrl: endpoint, cloudBoundary: boundary };
    const sequence = ++sequenceRef.current, owner = props.provider.id;
    pendingRef.current = true; setNotice(null); props.onBusy(true);
    try {
      const result = await window.pige.models.updateProviderProfile(request);
      const updated = result.providers.find((provider) => provider.id === owner);
      if (sequence !== sequenceRef.current || ownerRef.current !== owner || !updated ||
        updated.displayName !== name || updated.baseUrl !== new URL(endpoint).toString().replace(/\/$/u, "")) return;
      await props.onRefresh();
      if (sequence !== sequenceRef.current || ownerRef.current !== owner) return;
      restoreFocusRef.current = true; setEditing(false); setNotice("saved");
    } catch {
      if (sequence === sequenceRef.current && ownerRef.current === owner) setNotice("failed");
    } finally {
      if (sequence === sequenceRef.current && ownerRef.current === owner) pendingRef.current = false;
      props.onBusy(false);
    }
  };
  const changed = displayName.trim() !== props.provider.displayName ||
    baseUrl.trim().replace(/\/$/u, "") !== props.provider.baseUrl || boundary !== editableBoundary(props.provider.cloudBoundary);
  return <section className="settings-section" aria-labelledby="provider-profile-edit-title">
    <div className="settings-section-heading-row">
      <h2 className="settings-section-title" id="provider-profile-edit-title">{props.t("models.editConnection")}</h2>
      {!editing ? <button ref={triggerRef} type="button" className="settings-button" disabled={props.busy || !props.expectedRevision}
        onClick={() => { setEditing(true); setNotice(null); requestAnimationFrame(() => firstFieldRef.current?.focus()); }}>
        {props.t("models.editConnection")}</button> : null}
    </div>
    <p className="settings-note">{props.t("models.editConnectionDescription")}</p>
    {editing ? <div className="settings-card">
      <label className="settings-row"><span className="settings-row-copy"><strong>{props.t("field.name")}</strong></span>
        <input ref={firstFieldRef} className="settings-input" maxLength={80} value={displayName}
          disabled={props.busy} onChange={(event) => setDisplayName(event.currentTarget.value)} /></label>
      <label className="settings-row"><span className="settings-row-copy"><strong>{props.t("models.baseUrl")}</strong></span>
        <input className="settings-input" type="url" value={baseUrl} disabled={props.busy}
          onChange={(event) => setBaseUrl(event.currentTarget.value)} /></label>
      <label className="settings-row"><span className="settings-row-copy"><strong>{props.t("models.boundary")}</strong></span>
        <select className="settings-select" value={boundary} disabled={props.busy}
          onChange={(event) => setBoundary(event.currentTarget.value as Exclude<CloudBoundary, "local">)}>
          <option value="cloud">{props.t("models.cloud")}</option><option value="self_hosted">{props.t("models.selfHosted")}</option>
          <option value="unknown">{props.t("models.unknown")}</option>
        </select></label>
      <div className="settings-inline-actions"><button type="button" className="settings-button" disabled={props.busy} onClick={close}>{props.t("models.cancel")}</button>
        <button type="button" className="settings-button primary" disabled={props.busy || !changed || !displayName.trim() || !baseUrl.trim() || !props.expectedRevision}
          onClick={() => void save()}>{props.t(props.busy ? "models.savingConnection" : "models.saveConnection")}</button></div>
    </div> : null}
    {notice ? <p className={notice === "failed" ? "settings-warning model-settings-error" : "settings-warning"}
      role={notice === "failed" ? "alert" : "status"}>{props.t(`models.connectionEdit.${notice}`)}</p> : null}
  </section>;
}

function editableBoundary(boundary: CloudBoundary): Exclude<CloudBoundary, "local"> {
  return boundary === "local" ? "unknown" : boundary;
}
