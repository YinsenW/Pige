import { useEffect, useRef, useState } from "react";
import type { VaultSummary } from "@pige/contracts";
import { VaultDisplayNameSchema } from "@pige/schemas";

export interface VaultDisplayNameEditorProps {
  readonly vault: VaultSummary;
  readonly disabled: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onPendingChange: (pending: boolean) => void;
  readonly t: (key: string) => string;
}

export function VaultDisplayNameEditor(props: VaultDisplayNameEditorProps): React.JSX.Element {
  const [draft, setDraft] = useState(props.vault.name);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly key: string } | null>(null);
  const requestSequence = useRef(0);
  const pendingRef = useRef(false);
  const vaultIdRef = useRef(props.vault.vaultId);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (vaultIdRef.current === props.vault.vaultId) return;
    vaultIdRef.current = props.vault.vaultId;
    requestSequence.current += 1;
    if (pendingRef.current) props.onPendingChange(false);
    pendingRef.current = false;
    setDraft(props.vault.name);
    setEditing(false);
    setPending(false);
    setNotice(null);
  }, [props.vault.vaultId, props.vault.name]);

  useEffect(() => () => {
    requestSequence.current += 1;
    if (pendingRef.current) props.onPendingChange(false);
  }, [props.onPendingChange]);

  const save = async (): Promise<void> => {
    const revision = props.vault.metadataRevision;
    const parsedName = VaultDisplayNameSchema.safeParse(draft);
    if (pendingRef.current || !revision || !parsedName.success || parsedName.data === props.vault.name) return;
    const sequence = ++requestSequence.current;
    const vaultId = props.vault.vaultId;
    let focusTarget: "edit" | "save" = "save";
    pendingRef.current = true;
    setPending(true);
    props.onPendingChange(true);
    setNotice(null);
    try {
      const result = await window.pige.vault.renameDisplayName({
        apiVersion: 1,
        requestId: `vaultrenamereq_${crypto.randomUUID().replaceAll("-", "")}`,
        activeVaultId: vaultId,
        expectedMetadataRevision: revision,
        displayName: parsedName.data
      });
      if (sequence !== requestSequence.current || vaultIdRef.current !== vaultId) return;
      if (result.status === "renamed") {
        setDraft(result.metadata.displayName);
        setNotice({ kind: "status", key: "vaultSettings.rename.renamed" });
        setEditing(false);
        focusTarget = "edit";
        await props.onRefresh().catch(() => undefined);
      } else if (result.status === "stale") {
        setNotice({ kind: "error", key: "vaultSettings.rename.stale" });
        await props.onRefresh().catch(() => undefined);
      } else {
        setNotice({
          kind: "error",
          key: result.status === "not_found" ? "vaultSettings.rename.notFound" : "vaultSettings.rename.failed"
        });
      }
    } catch {
      if (sequence === requestSequence.current && vaultIdRef.current === vaultId) {
        setNotice({ kind: "error", key: "vaultSettings.rename.failed" });
      }
    } finally {
      if (sequence === requestSequence.current && vaultIdRef.current === vaultId) {
        pendingRef.current = false;
        setPending(false);
        props.onPendingChange(false);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
          (focusTarget === "edit" ? editButtonRef.current : saveButtonRef.current)?.focus()
        ));
      }
    }
  };

  const beginEditing = (): void => {
    setDraft(props.vault.name);
    setNotice(null);
    setEditing(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cancelEditing = (): void => {
    if (pendingRef.current) return;
    setDraft(props.vault.name);
    setNotice(null);
    setEditing(false);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const valid = VaultDisplayNameSchema.safeParse(draft).success;
  return <div className="settings-row tall">
    <div className="settings-row-copy">
      {editing ? <label htmlFor="vault-display-name"><strong>{props.t("vaultSettings.rename.label")}</strong></label>
        : <strong>{props.vault.name}</strong>}
      <span>{props.vault.activeVaultPathDisplay}</span>
      {editing ? <input ref={inputRef} id="vault-display-name" className="settings-input" value={draft} maxLength={80}
        aria-describedby="vault-display-name-description" disabled={props.disabled || pending}
        onChange={(event) => { setDraft(event.target.value); setNotice(null); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelEditing(); } }} /> : null}
      <span id="vault-display-name-description">{props.t("vaultSettings.rename.description")}</span>
    </div>
    <div className="settings-row-control">
      {editing ? <><button ref={saveButtonRef} className="settings-button" type="button" aria-busy={pending || undefined}
        disabled={props.disabled || pending || !props.vault.metadataRevision || !valid || draft === props.vault.name}
        onClick={() => void save()}>{props.t(pending ? "vaultSettings.rename.saving" : "vaultSettings.rename.save")}</button>
      <button className="settings-button" type="button" disabled={props.disabled || pending}
        onClick={cancelEditing}>{props.t("vaultSettings.rename.cancel")}</button></>
        : <button ref={editButtonRef} className="settings-button" type="button" disabled={props.disabled}
          onClick={beginEditing}>{props.t("vaultSettings.rename.edit")}</button>}
      {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
        role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{props.t(notice.key)}</span> : null}
    </div>
  </div>;
}
