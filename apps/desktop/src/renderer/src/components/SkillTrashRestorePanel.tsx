import { useEffect, useRef, useState } from "react";
import type { SkillRegistrySummary, SkillRestorableSummary } from "@pige/contracts";

type RestoreNotice = "restored" | "stale" | "failed";

export function SkillTrashRestorePanel(props: {
  readonly registry: SkillRegistrySummary | null;
  readonly disabled: boolean;
  readonly onCommitted: (registry: SkillRegistrySummary, skillId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [pendingContextId, setPendingContextId] = useState<string | null>(null);
  const [notice, setNotice] = useState<RestoreNotice | null>(null);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const sectionRef = useRef<HTMLElement>(null);
  const identityKey = props.registry
    ? `${props.registry.revision}:${props.registry.restorableSkills.map((item) => item.restoreContextId).join(":")}`
    : "unavailable";

  useEffect(() => {
    const wasActive = requestActiveRef.current;
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setPendingContextId(null);
    setNotice(null);
    if (wasActive) deferSkillFocus(() => sectionRef.current?.focus());
  }, [identityKey]);

  const restore = async (item: SkillRestorableSummary): Promise<void> => {
    const registry = props.registry;
    if (!registry || props.disabled || item.canRestore !== true || requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const operationIdentity = identityKey;
    const requestId = `skill_lifecycle_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}` as const;
    setPendingContextId(item.restoreContextId);
    setNotice(null);
    let committed = false;
    try {
      const requestedVault = await window.pige.vault.current();
      if (!requestedVault || sequence !== requestSequenceRef.current || operationIdentity !== identityKey) return;
      const result = await window.pige.skills.restore({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVault.vaultId,
        scope: item.scope,
        restoreContextId: item.restoreContextId,
        skillId: item.skillId,
        expectedRegistryRevision: registry.revision
      });
      const currentVault = await window.pige.vault.current();
      if (sequence !== requestSequenceRef.current || operationIdentity !== identityKey ||
        result.requestId !== requestId || result.activeVaultId !== requestedVault.vaultId ||
        result.scope !== item.scope ||
        result.restoreContextId !== item.restoreContextId || result.skillId !== item.skillId ||
        currentVault?.vaultId !== requestedVault.vaultId) return;
      if (result.status === "committed") {
        const restored = result.registry.skills.find((skill) => skill.id === item.skillId && skill.scope === item.scope);
        if (!restored || restored.enabled || result.registry.restorableSkills.some((skill) => skill.skillId === item.skillId)) {
          setNotice("failed");
          return;
        }
        committed = true;
        requestActiveRef.current = false;
        setPendingContextId(null);
        setNotice("restored");
        props.onCommitted(result.registry, item.skillId);
      } else setNotice(result.status === "failed" ? "failed" : "stale");
    } catch {
      if (sequence === requestSequenceRef.current && operationIdentity === identityKey) setNotice("failed");
    } finally {
      if (!committed && sequence === requestSequenceRef.current && operationIdentity === identityKey) {
        requestActiveRef.current = false;
        setPendingContextId(null);
        deferSkillFocus(() => (triggerRefs.current.get(item.restoreContextId) ?? sectionRef.current)?.focus());
      }
    }
  };

  if (!props.registry || props.registry.restorableSkills.length === 0) return null;
  return <section ref={sectionRef} className="settings-section" aria-labelledby="skill-trash-restore-title" tabIndex={-1}>
    <h2 className="settings-section-title" id="skill-trash-restore-title">{props.t("skills.restoreTitle")}</h2>
    <div className="settings-card">
      {props.registry.restorableSkills.map((item) => <div className="settings-row" key={item.restoreContextId} data-restorable-skill-id={item.skillId}>
        <div className="settings-row-copy"><strong>{item.name}</strong><span>{`v${item.version} · ${formatUninstalledAt(item.uninstalledAt)}`}</span></div>
        {item.canRestore ? <button
          ref={(element) => { if (element) triggerRefs.current.set(item.restoreContextId, element); else triggerRefs.current.delete(item.restoreContextId); }}
          className="settings-button"
          type="button"
          aria-label={`${props.t("skills.restore")}: ${item.name}`}
          disabled={props.disabled || pendingContextId !== null}
          aria-busy={pendingContextId === item.restoreContextId || undefined}
          onClick={() => void restore(item)}
        >{pendingContextId === item.restoreContextId ? props.t("skills.restoring") : props.t("skills.restore")}</button> : null}
      </div>)}
    </div>
    {notice ? <p className={notice === "restored" ? "settings-note" : "error"}
      role={notice === "restored" ? "status" : "alert"} aria-live="polite">{props.t(`skills.restore.${notice}`)}</p> : null}
  </section>;
}

export function formatSkillByteSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;
}

function formatUninstalledAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function deferSkillFocus(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
  else window.setTimeout(callback, 0);
}
