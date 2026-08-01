import { useEffect, useRef, useState } from "react";
import type { PigeDesktopApi } from "@pige/contracts";
import type { PigePolicySummary, PigePolicyValidationIssue } from "@pige/schemas";

type Translate = (key: string) => string;

export interface PigePolicySettingsPanelProps {
  readonly activeVaultId: string | null;
  readonly api?: PigeDesktopApi["settings"];
  readonly t: Translate;
}

export function PigePolicySettingsPanel(props: PigePolicySettingsPanelProps): React.JSX.Element {
  const api = props.api ?? window.pige.settings;
  const [summary, setSummary] = useState<PigePolicySummary | null>(null);
  const [readState, setReadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly PigePolicyValidationIssue[]>([]);
  const activeVaultRef = useRef(props.activeVaultId);
  const requestSequenceRef = useRef(0);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  activeVaultRef.current = props.activeVaultId;

  useEffect(() => {
    const vaultId = props.activeVaultId;
    requestSequenceRef.current += 1;
    setSummary(null);
    setDraft(null);
    setSaving(false);
    setStatusKey(null);
    setIssues([]);
    if (!vaultId) {
      setReadState("idle");
      return;
    }
    let current = true;
    setReadState("loading");
    void api.pigePolicy().then((next) => {
      if (!current || activeVaultRef.current !== vaultId || next.activeVaultId !== vaultId) return;
      setSummary(next);
      setReadState("ready");
    }).catch(() => {
      if (current && activeVaultRef.current === vaultId) setReadState("failed");
    });
    return () => { current = false; };
  }, [api, props.activeVaultId]);

  useEffect(() => {
    if (draft !== null) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draft !== null]);

  const beginEdit = (): void => {
    if (!summary || saving) return;
    setDraft(summary.markdown);
    setStatusKey(null);
    setIssues([]);
  };

  const cancelEdit = (): void => {
    if (saving) return;
    setDraft(null);
    setStatusKey(null);
    setIssues([]);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = async (): Promise<void> => {
    const vaultId = props.activeVaultId;
    if (!summary || draft === null || !vaultId || saving || draft === summary.markdown) return;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setSaving(true);
    setStatusKey(null);
    setIssues([]);
    try {
      const result = await api.updatePigePolicy({
        apiVersion: 1,
        requestId: `pigepolicyreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: vaultId,
        expectedRevision: summary.revision,
        markdown: draft
      });
      if (requestSequenceRef.current !== sequence || activeVaultRef.current !== vaultId) return;
      if (result.status === "updated") {
        setSummary(result.summary);
        setDraft(null);
        setStatusKey("pigePolicy.updated");
        window.requestAnimationFrame(() => editButtonRef.current?.focus());
      } else if (result.status === "invalid") {
        setSummary(result.summary);
        setIssues(result.issues);
        setStatusKey("pigePolicy.invalid");
      } else if (result.status === "stale") {
        setSummary(result.summary);
        setStatusKey("pigePolicy.stale");
      } else if (result.status === "denied") {
        setSummary(result.summary);
        setStatusKey("pigePolicy.denied");
      } else {
        setStatusKey("pigePolicy.failed");
      }
    } catch {
      if (requestSequenceRef.current === sequence && activeVaultRef.current === vaultId) setStatusKey("pigePolicy.failed");
    } finally {
      if (requestSequenceRef.current === sequence && activeVaultRef.current === vaultId) setSaving(false);
    }
  };

  return <section className="settings-card" aria-labelledby="pige-policy-settings-title">
    <div className="settings-card-heading">
      <div>
        <h3 id="pige-policy-settings-title">{props.t("pigePolicy.title")}</h3>
        <p>{props.t("pigePolicy.description")}</p>
      </div>
      {summary && draft === null ? <button
        ref={editButtonRef}
        className="settings-button"
        type="button"
        disabled={saving || !summary.canEdit}
        onClick={beginEdit}
      >{props.t("pigePolicy.edit")}</button> : null}
    </div>
    {readState === "idle" ? <p className="settings-muted">{props.t("pigePolicy.noVault")}</p> : null}
    {readState === "loading" ? <p className="settings-muted" role="status">{props.t("pigePolicy.loading")}</p> : null}
    {readState === "failed" ? <p className="settings-warning" role="alert">{props.t("pigePolicy.failed")}</p> : null}
    {summary && draft === null ? <pre className="settings-code-preview" tabIndex={0}>{summary.markdown}</pre> : null}
    {summary && draft !== null ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="settings-field">
        <span>{props.t("pigePolicy.editorLabel")}</span>
        <textarea
          ref={textareaRef}
          rows={18}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              cancelEdit();
            }
          }}
        />
      </label>
      <p className="settings-muted">{props.t("pigePolicy.requiredSections")}: {summary.requiredSections.join(" · ")}</p>
      {issues.length > 0 ? <ul className="settings-warning" role="alert">
        {issues.map((issue) => <li key={issue}>{props.t(`pigePolicy.issue.${issue}`)}</li>)}
      </ul> : null}
      <div className="settings-actions">
        <button className="settings-button" type="button" disabled={saving} onClick={cancelEdit}>{props.t("pigePolicy.cancel")}</button>
        <button className="settings-button settings-action" type="submit" disabled={saving || draft === summary.markdown}>
          {props.t(saving ? "pigePolicy.saving" : "pigePolicy.save")}
        </button>
      </div>
    </form> : null}
    {statusKey ? <p className={statusKey === "pigePolicy.updated" ? "settings-success" : "settings-warning"} role="status">{props.t(statusKey)}</p> : null}
  </section>;
}
