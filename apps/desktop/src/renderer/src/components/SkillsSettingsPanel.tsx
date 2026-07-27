import { useEffect, useRef, useState } from "react";
import type {
  SkillExportResult,
  SkillLifecycleMutationResult,
  SkillStageInvalidReason,
  SkillStageUpdateResult,
  SkillStagedSummary,
  SkillRegistryQueryResult,
  SkillRegistrySummary,
  SkillSummary
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

type InstalledLifecycleKind = "disable" | "enable" | "export" | "uninstall" | "update";

interface InstalledLifecycleAction {
  readonly kind: InstalledLifecycleKind;
  readonly skillId: string;
}

interface UninstallConfirmation {
  readonly skill: SkillSummary;
  readonly expectedRevision: number;
}

type StagedSkillReview =
  | { readonly kind: "install"; readonly staged: SkillStagedSummary }
  | {
    readonly kind: "update";
    readonly staged: SkillStagedSummary;
    readonly skillId: string;
    readonly enabled: boolean;
  };

export function SkillsSettingsPanel(props: {
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [registry, setRegistry] = useState<SkillRegistrySummary | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [lifecycleAction, setLifecycleAction] = useState<InstalledLifecycleAction | null>(null);
  const [uninstallConfirmation, setUninstallConfirmation] = useState<UninstallConfirmation | null>(null);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [stagedReview, setStagedReview] = useState<StagedSkillReview | null>(null);
  const [installBusy, setInstallBusy] = useState<"stage" | "install" | "discard" | null>(null);
  const latestRevisionRef = useRef(-1);
  const mountedRef = useRef(true);
  const lifecycleSequenceRef = useRef(0);
  const lifecycleActiveRef = useRef(false);
  const uninstallConfirmationActiveRef = useRef(false);
  const installOperationRef = useRef(0);
  const pendingFocusRef = useRef<"trigger" | "url" | null>(null);
  const pendingInstalledFocusRef = useRef<{
    readonly skillId: string | null;
    readonly action?: InstalledLifecycleKind;
  } | undefined>(undefined);
  const installTriggerRef = useRef<HTMLButtonElement | null>(null);
  const installUrlRef = useRef<HTMLInputElement | null>(null);
  const stagedPrimaryActionRef = useRef<HTMLButtonElement | null>(null);
  const uninstallTriggerRef = useRef<HTMLButtonElement | null>(null);
  const uninstallCancelRef = useRef<HTMLButtonElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pendingFocusRef.current === "trigger" && !installOpen) {
      pendingFocusRef.current = null;
      installTriggerRef.current?.focus();
    } else if (pendingFocusRef.current === "url" && installOpen && !stagedReview) {
      pendingFocusRef.current = null;
      installUrlRef.current?.focus();
    }
  }, [installOpen, stagedReview]);

  useEffect(() => {
    if (stagedReview?.kind === "update") stagedPrimaryActionRef.current?.focus();
  }, [stagedReview]);

  useEffect(() => {
    if (uninstallConfirmation) uninstallCancelRef.current?.focus();
  }, [uninstallConfirmation]);

  useEffect(() => {
    if (pendingInstalledFocusRef.current === undefined || lifecycleAction !== null || uninstallConfirmation !== null) {
      return;
    }
    const pendingFocus = pendingInstalledFocusRef.current;
    pendingInstalledFocusRef.current = undefined;
    const selector = pendingFocus.skillId
      ? `[data-skill-id="${pendingFocus.skillId}"] ${pendingFocus.action === "update"
        ? '[data-skill-update="true"]'
        : "button:not(:disabled)"}`
      : undefined;
    const action = selector ? pageRef.current?.querySelector<HTMLButtonElement>(selector) : null;
    (action ?? installTriggerRef.current)?.focus();
  }, [lifecycleAction, registry, uninstallConfirmation]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let requestCurrent = true;
    const adoptRegistry = (next: SkillRegistrySummary): void => {
      if (!active || next.revision < latestRevisionRef.current) return;
      latestRevisionRef.current = next.revision;
      setRegistry(next);
      setReadState("ready");
    };
    const unsubscribe = window.pige.skills.onChanged(adoptRegistry);
    if (registry === null) setReadState("loading");
    void window.pige.skills.summary().then((result: SkillRegistryQueryResult) => {
      if (!requestCurrent) return;
      if (result.status === "failed") {
        if (active && latestRevisionRef.current < 0) setReadState("failed");
        return;
      }
      adoptRegistry(result.registry);
    }).catch(() => {
      if (active && requestCurrent && latestRevisionRef.current < 0) setReadState("failed");
    });
    return () => {
      active = false;
      requestCurrent = false;
      mountedRef.current = false;
      unsubscribe();
    };
  }, [reloadSequence]);

  const beginLifecycleAction = (kind: InstalledLifecycleKind, skillId: string): number | null => {
    if (lifecycleActiveRef.current || installBusy !== null ||
        (uninstallConfirmationActiveRef.current && kind !== "uninstall")) {
      return null;
    }
    lifecycleActiveRef.current = true;
    const sequence = lifecycleSequenceRef.current + 1;
    lifecycleSequenceRef.current = sequence;
    setLifecycleAction({ kind, skillId });
    setStatusKey(null);
    return sequence;
  };

  const isCurrentLifecycleAction = (sequence: number): boolean => (
    mountedRef.current && lifecycleSequenceRef.current === sequence
  );

  const finishLifecycleAction = (sequence: number): void => {
    if (!isCurrentLifecycleAction(sequence)) return;
    lifecycleActiveRef.current = false;
    setLifecycleAction(null);
  };

  const adoptRegistry = (next: SkillRegistrySummary): void => {
    if (next.revision < latestRevisionRef.current) return;
    latestRevisionRef.current = next.revision;
    setRegistry(next);
    setReadState("ready");
  };

  const reloadAuthoritativeRegistry = async (sequence: number): Promise<void> => {
    try {
      const result = await window.pige.skills.summary();
      if (isCurrentLifecycleAction(sequence) && result.status === "ready") adoptRegistry(result.registry);
    } catch {
      // The body-free lifecycle status remains authoritative even if refresh is unavailable.
    }
  };

  const queueInstalledFocus = (skillId?: string, action?: InstalledLifecycleKind): void => {
    pendingInstalledFocusRef.current = {
      skillId: skillId ?? null,
      ...(action ? { action } : {})
    };
  };

  const closeUninstallConfirmation = (): void => {
    const trigger = uninstallTriggerRef.current;
    uninstallConfirmationActiveRef.current = false;
    setUninstallConfirmation(null);
    deferFocus(() => trigger?.isConnected && trigger.focus());
  };

  const disableSkill = async (skill: SkillSummary): Promise<void> => {
    if (!registry || !skill.enabled) return;
    const sequence = beginLifecycleAction("disable", skill.id);
    if (sequence === null) return;
    try {
      const result = await window.pige.skills.disable({
        apiVersion: 1,
        skillId: skill.id,
        expectedRevision: registry.revision
      });
      if (!isCurrentLifecycleAction(sequence)) return;
      if (result.status === "failed") {
        setStatusKey(result.error.code === "skill.registry_busy"
          ? "skills.registryBusy"
          : "skills.registryUnavailable");
        return;
      }
      adoptRegistry(result.registry);
      setStatusKey(result.status === "committed"
        ? "skills.disableCompleted"
        : result.status === "stale"
          ? "skills.registryChanged"
          : "skills.skillUnavailable");
    } catch {
      if (isCurrentLifecycleAction(sequence)) setStatusKey("skills.disableFailed");
    } finally {
      finishLifecycleAction(sequence);
    }
  };

  const mutateInstalledSkill = async (
    kind: "enable" | "uninstall",
    skill: SkillSummary,
    expectedRevision: number
  ): Promise<void> => {
    if ((kind === "enable" && !skill.canEnable) || (kind === "uninstall" && !skill.canUninstall)) return;
    const sequence = beginLifecycleAction(kind, skill.id);
    if (sequence === null) return;
    const requestId = createSkillLifecycleRequestId();
    try {
      const requestedVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!requestedVault) {
        setStatusKey("skills.lifecycleFailed");
        return;
      }
      const result = await window.pige.skills[kind]({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVault.vaultId,
        skillId: skill.id,
        expectedRegistryRevision: expectedRevision
      });
      if (!isCurrentLifecycleAction(sequence)) return;
      const currentVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!matchesLifecycleIdentity(result, requestId, requestedVault.vaultId, skill.id) ||
          currentVault?.vaultId !== requestedVault.vaultId) {
        setStatusKey("skills.lifecycleFailed");
        return;
      }
      if (result.status === "failed") {
        setStatusKey("skills.lifecycleFailed");
        if (kind === "uninstall") {
          uninstallConfirmationActiveRef.current = false;
          setUninstallConfirmation(null);
          queueInstalledFocus(skill.id);
        }
        return;
      }
      adoptRegistry(result.registry);
      setStatusKey(result.status === "committed"
        ? kind === "enable" ? "skills.enableCompleted" : "skills.uninstallCompleted"
        : result.status === "stale" ? "skills.registryChanged" : "skills.skillUnavailable");
      if (kind === "uninstall") {
        const previous = registry;
        const removedIndex = previous?.skills.findIndex((candidate) => candidate.id === skill.id) ?? -1;
        const focusSkill = result.registry.skills[removedIndex]?.id ?? result.registry.skills.at(-1)?.id;
        uninstallConfirmationActiveRef.current = false;
        setUninstallConfirmation(null);
        queueInstalledFocus(focusSkill);
      } else {
        queueInstalledFocus(skill.id);
      }
    } catch {
      if (isCurrentLifecycleAction(sequence)) {
        setStatusKey("skills.lifecycleFailed");
        if (kind === "uninstall") {
          uninstallConfirmationActiveRef.current = false;
          setUninstallConfirmation(null);
          queueInstalledFocus(skill.id);
        }
      }
    } finally {
      finishLifecycleAction(sequence);
    }
  };

  const exportInstalledSkill = async (skill: SkillSummary): Promise<void> => {
    if (!registry || !skill.canExport) return;
    const expectedRevision = registry.revision;
    const sequence = beginLifecycleAction("export", skill.id);
    if (sequence === null) return;
    const requestId = createSkillLifecycleRequestId();
    try {
      const requestedVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!requestedVault) {
        setStatusKey("skills.exportFailed");
        return;
      }
      const result = await window.pige.skills.export({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVault.vaultId,
        skillId: skill.id,
        expectedRegistryRevision: expectedRevision
      });
      if (!isCurrentLifecycleAction(sequence)) return;
      const currentVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!matchesLifecycleIdentity(result, requestId, requestedVault.vaultId, skill.id) ||
          currentVault?.vaultId !== requestedVault.vaultId ||
          (result.status === "exported" || result.status === "cancelled") &&
            result.registryRevision !== expectedRevision) {
        setStatusKey("skills.exportFailed");
        return;
      }
      if (result.status === "cancelled") return;
      if (result.status === "stale" || result.status === "not_found") {
        await reloadAuthoritativeRegistry(sequence);
        setStatusKey(result.status === "stale" ? "skills.registryChanged" : "skills.skillUnavailable");
        return;
      }
      setStatusKey(result.status === "exported" ? "skills.exportCompleted" : "skills.exportFailed");
    } catch {
      if (isCurrentLifecycleAction(sequence)) setStatusKey("skills.exportFailed");
    } finally {
      finishLifecycleAction(sequence);
      queueInstalledFocus(skill.id);
    }
  };

  const stageInstalledSkillUpdate = async (skill: SkillSummary): Promise<void> => {
    if (!registry || !skill.canUpdate || stagedReview || installOpen) return;
    const expectedRegistryRevision = registry.revision;
    const sequence = beginLifecycleAction("update", skill.id);
    if (sequence === null) return;
    const requestId = createSkillLifecycleRequestId();
    try {
      const requestedVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!requestedVault) {
        setStatusKey("skills.updateFailed");
        return;
      }
      const result = await window.pige.skills.stageUpdate({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVault.vaultId,
        skillId: skill.id,
        expectedRegistryRevision
      });
      if (!isCurrentLifecycleAction(sequence)) return;
      const currentVault = await window.pige.vault.current();
      if (!isCurrentLifecycleAction(sequence)) return;
      if (!matchesLifecycleIdentity(result, requestId, requestedVault.vaultId, skill.id) ||
          currentVault?.vaultId !== requestedVault.vaultId) {
        setStatusKey("skills.updateFailed");
        return;
      }
      if (result.status === "ready") {
        setInstallOpen(true);
        setStagedReview({ kind: "update", staged: result.staged, skillId: skill.id, enabled: skill.enabled });
        return;
      }
      if (result.status === "failed") {
        setStatusKey("skills.updateFailed");
        queueInstalledFocus(skill.id, "update");
        return;
      }
      adoptRegistry(result.registry);
      setStatusKey(result.status === "current"
        ? "skills.updateCurrent"
        : result.status === "stale"
          ? "skills.updateStale"
          : "skills.updateUnavailable");
      queueInstalledFocus(skill.id, "update");
    } catch {
      if (isCurrentLifecycleAction(sequence)) {
        setStatusKey("skills.updateFailed");
        queueInstalledFocus(skill.id, "update");
      }
    } finally {
      finishLifecycleAction(sequence);
    }
  };

  const openUninstallConfirmation = (skill: SkillSummary): void => {
    if (!registry || lifecycleActiveRef.current || uninstallConfirmationActiveRef.current || !skill.canUninstall) return;
    uninstallConfirmationActiveRef.current = true;
    uninstallTriggerRef.current = pageRef.current?.querySelector<HTMLButtonElement>(
      `[data-skill-id="${skill.id}"] [data-skill-uninstall="true"]`
    ) ?? null;
    setStatusKey(null);
    setUninstallConfirmation({
      skill,
      expectedRevision: registry.revision
    });
  };

  const finishInstallOperation = (operation: number): boolean => (
    mountedRef.current && installOperationRef.current === operation
  );

  const stageFromUrl = async (): Promise<void> => {
    if (installBusy || lifecycleActiveRef.current || uninstallConfirmationActiveRef.current || stagedReview || installUrl.length === 0) return;
    const operation = installOperationRef.current + 1;
    installOperationRef.current = operation;
    setInstallBusy("stage");
    setStatusKey(null);
    try {
      const requestId = createSkillInstallRequestId();
      const result = await window.pige.skills.stageFromUrl({
        apiVersion: 1,
        requestId,
        sourceUrl: installUrl
      });
      if (!finishInstallOperation(operation)) return;
      if (result.requestId !== requestId) {
        setStatusKey("skills.stageFailed");
        return;
      }
      if (result.status === "ready") {
        setStagedReview({ kind: "install", staged: result.staged });
        return;
      }
      setStatusKey(result.status === "invalid"
        ? invalidStageStatusKey(result.reason)
        : "skills.stageFailed");
    } catch {
      if (finishInstallOperation(operation)) setStatusKey("skills.stageFailed");
    } finally {
      if (finishInstallOperation(operation)) setInstallBusy(null);
    }
  };

  const installStaged = async (): Promise<void> => {
    if (installBusy || lifecycleActiveRef.current || uninstallConfirmationActiveRef.current || !stagedReview) return;
    const review = stagedReview;
    const staged = review.staged;
    const operation = installOperationRef.current + 1;
    installOperationRef.current = operation;
    setInstallBusy("install");
    setStatusKey(null);
    try {
      const requestId = createSkillInstallRequestId();
      const result = await window.pige.skills.installStaged({
        apiVersion: 1,
        requestId,
        stagingId: staged.stagingId,
        manifestSha256: staged.manifestSha256,
        expectedRegistryRevision: staged.registryRevision,
        enabled: review.kind === "update" ? review.enabled : true
      });
      if (!finishInstallOperation(operation)) return;
      if (result.requestId !== requestId) {
        setStatusKey("skills.installFailed");
        return;
      }
      if (result.status === "committed" || result.status === "stale") {
        latestRevisionRef.current = Math.max(latestRevisionRef.current, result.registry.revision);
        setRegistry(result.registry);
        setReadState("ready");
      }
      if (result.status === "committed") {
        setStagedReview(null);
        setInstallUrl("");
        setInstallOpen(false);
        setStatusKey(review.kind === "update" ? "skills.updateCompleted" : "skills.installCompleted");
        if (review.kind === "update") queueInstalledFocus(review.skillId, "update");
        else pendingFocusRef.current = "trigger";
      } else if (result.status === "stale") {
        setStagedReview(null);
        setStatusKey(review.kind === "update" ? "skills.updateStale" : "skills.installReviewExpired");
        if (review.kind === "update") {
          setInstallOpen(false);
          queueInstalledFocus(review.skillId, "update");
        } else pendingFocusRef.current = "url";
      } else if (result.status === "not_found") {
        setStagedReview(null);
        setStatusKey(review.kind === "update" ? "skills.updateUnavailable" : "skills.installReviewUnavailable");
        if (review.kind === "update") {
          setInstallOpen(false);
          queueInstalledFocus(review.skillId, "update");
        } else pendingFocusRef.current = "url";
      } else {
        setStatusKey(review.kind === "update" ? "skills.updateFailed" : "skills.installFailed");
      }
    } catch {
      if (finishInstallOperation(operation)) {
        setStatusKey(review.kind === "update" ? "skills.updateFailed" : "skills.installFailed");
      }
    } finally {
      if (finishInstallOperation(operation)) setInstallBusy(null);
    }
  };

  const discardStaged = async (): Promise<void> => {
    if (installBusy || lifecycleActiveRef.current || uninstallConfirmationActiveRef.current || !stagedReview) return;
    const review = stagedReview;
    const staged = review.staged;
    const operation = installOperationRef.current + 1;
    installOperationRef.current = operation;
    setInstallBusy("discard");
    setStatusKey(null);
    try {
      const requestId = createSkillInstallRequestId();
      const result = await window.pige.skills.discardStaged({
        apiVersion: 1,
        requestId,
        stagingId: staged.stagingId,
        manifestSha256: staged.manifestSha256
      });
      if (!finishInstallOperation(operation)) return;
      if (result.requestId !== requestId) {
        setStatusKey("skills.discardFailed");
        return;
      }
      if (result.status === "failed") {
        setStatusKey("skills.discardFailed");
        return;
      }
      setStagedReview(null);
      setStatusKey(result.status === "discarded"
        ? null
        : review.kind === "update" ? "skills.updateUnavailable" : "skills.installReviewUnavailable");
      if (review.kind === "update") {
        setInstallOpen(false);
        queueInstalledFocus(review.skillId, "update");
      } else pendingFocusRef.current = "url";
    } catch {
      if (finishInstallOperation(operation)) setStatusKey("skills.discardFailed");
    } finally {
      if (finishInstallOperation(operation)) setInstallBusy(null);
    }
  };

  const closeInstall = (): void => {
    if (installBusy || lifecycleActiveRef.current || uninstallConfirmationActiveRef.current || stagedReview) return;
    installOperationRef.current += 1;
    setInstallOpen(false);
    setInstallUrl("");
    setStatusKey(null);
    pendingFocusRef.current = "trigger";
  };

  return (
    <section ref={pageRef} className="settings-page settings-skills" aria-labelledby="settings-skills-title">
      <header className="settings-panel-header">
        <h1 id="settings-skills-title">{props.t("skills.title")}</h1>
        <p>{props.t("skills.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="skills-installed-title">
        <h2 className="settings-section-title" id="skills-installed-title">{props.t("skills.installedTitle")}</h2>
        {readState === "loading" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="loading" size={19} className="spinning" /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.loadingTitle")}</strong>
              <span>{props.t("skills.loadingDescription")}</span>
            </div>
          </div>
        ) : readState === "failed" ? (
          <div className="settings-card skills-empty-card" role="status" aria-live="polite">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="shield" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.loadFailedTitle")}</strong>
              <span>{props.t("skills.loadFailedDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={() => setReloadSequence((current) => current + 1)}>
              {props.t("skills.retryLoad")}
            </button>
          </div>
        ) : registry && registry.skills.length > 0 ? (
          <div className="settings-card skills-registry-list" data-skill-registry-revision={registry.revision}>
            {registry.skills.map((skill) => (
              <div className="settings-row tall skill-registry-row" data-skill-id={skill.id} key={skill.id}>
                <span className={`skills-empty-icon${skill.enabled ? " is-enabled" : ""}`} aria-hidden="true">
                  <PigeIcon name="skill" size={18} />
                </span>
                <div className="settings-row-copy skill-registry-copy">
                  <strong>{skill.name}</strong>
                  <span>{skill.description}</span>
                  <div className="skill-registry-meta" aria-label={props.t("skills.skillDetails")}>
                    <span>{`v${skill.version}`}</span>
                    <span>{props.t(`skills.kind.${skill.kind}`)}</span>
                    <span>{props.t(`skills.scope.${skill.scope}`)}</span>
                    {skill.dataBoundaries.map((boundary) => (
                      <span key={boundary}>{props.t(`skills.boundary.${boundary}`)}</span>
                    ))}
                  </div>
                </div>
                <div className="settings-row-control skill-registry-control">
                  <span className={`settings-status ${skill.enabled ? "is-enabled" : "neutral"}`}>
                    {props.t(skill.enabled ? "skills.statusEnabled" : "skills.statusDisabled")}
                  </span>
                  {skill.enabled ? <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("skills.disable")}: ${skill.name}`}
                    disabled={lifecycleAction !== null || installBusy !== null || uninstallConfirmation !== null}
                    title={props.t("skills.disableDescription")}
                    onClick={() => void disableSkill(skill)}
                  >
                    {lifecycleAction?.kind === "disable" && lifecycleAction.skillId === skill.id
                      ? props.t("skills.disabling") : props.t("skills.disable")}
                  </button> : skill.canEnable ? <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("skills.enable")}: ${skill.name}`}
                    disabled={lifecycleAction !== null || installBusy !== null || uninstallConfirmation !== null}
                    title={props.t("skills.enableDescription")}
                    onClick={() => void mutateInstalledSkill("enable", skill, registry.revision)}
                  >
                    {lifecycleAction?.kind === "enable" && lifecycleAction.skillId === skill.id
                      ? props.t("skills.enabling") : props.t("skills.enable")}
                  </button> : null}
                  {skill.canExport ? <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("skills.export")}: ${skill.name}`}
                    disabled={lifecycleAction !== null || installBusy !== null || uninstallConfirmation !== null}
                    onClick={() => void exportInstalledSkill(skill)}
                  >
                    {lifecycleAction?.kind === "export" && lifecycleAction.skillId === skill.id
                      ? props.t("skills.exporting") : props.t("skills.export")}
                  </button> : null}
                  {skill.canUpdate ? <button
                    className="settings-button"
                    type="button"
                    data-skill-update="true"
                    aria-label={`${props.t("skills.update")}: ${skill.name}`}
                    disabled={lifecycleAction !== null || installBusy !== null || uninstallConfirmation !== null || installOpen}
                    onClick={() => void stageInstalledSkillUpdate(skill)}
                  >
                    {lifecycleAction?.kind === "update" && lifecycleAction.skillId === skill.id
                      ? props.t("skills.checkingUpdate") : props.t("skills.update")}
                  </button> : null}
                  {skill.canUninstall ? <button
                    className="settings-button danger"
                    type="button"
                    data-skill-uninstall="true"
                    aria-label={`${props.t("skills.uninstall")}: ${skill.name}`}
                    disabled={lifecycleAction !== null || installBusy !== null || uninstallConfirmation !== null}
                    onClick={() => openUninstallConfirmation(skill)}
                  >
                    {lifecycleAction?.kind === "uninstall" && lifecycleAction.skillId === skill.id
                      ? props.t("skills.uninstalling") : props.t("skills.uninstall")}
                  </button> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="settings-card skills-empty-card">
            <span className="skills-empty-icon" aria-hidden="true"><PigeIcon name="skill" size={19} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.emptyTitle")}</strong>
              <span>{props.t("skills.emptyDescription")}</span>
            </div>
          </div>
        )}
        {uninstallConfirmation ? (
          <div
            className="settings-card"
            role="alertdialog"
            aria-labelledby="skill-uninstall-title"
            aria-describedby="skill-uninstall-description"
            aria-busy={lifecycleAction?.kind === "uninstall" || undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape" && lifecycleAction === null) closeUninstallConfirmation();
            }}
          >
            <div className="settings-row tall">
              <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="trash" size={17} /></span>
              <div className="settings-row-copy">
                <strong id="skill-uninstall-title">{props.t("skills.uninstallConfirmTitle")}</strong>
                <span id="skill-uninstall-description">{props.t("skills.uninstallConfirmDescription")}</span>
                <span>{uninstallConfirmation.skill.name}</span>
              </div>
              <div className="settings-row-control">
                <button
                  ref={uninstallCancelRef}
                  className="settings-button"
                  type="button"
                  disabled={lifecycleAction !== null}
                  onClick={closeUninstallConfirmation}
                >
                  {props.t("skills.uninstallCancel")}
                </button>
                <button
                  className="settings-button danger"
                  type="button"
                  disabled={lifecycleAction !== null}
                  onClick={() => {
                    void mutateInstalledSkill(
                      "uninstall",
                      uninstallConfirmation.skill,
                      uninstallConfirmation.expectedRevision
                    );
                  }}
                >
                  {lifecycleAction?.kind === "uninstall"
                    ? props.t("skills.uninstalling") : props.t("skills.uninstallConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {registry && registry.invalidManifestCount > 0 ? (
          <p className="settings-note skill-registry-warning" role="status" data-invalid-skill-count={registry.invalidManifestCount}>
            {props.t("skills.invalidManifestWarning")}
          </p>
        ) : null}
        {statusKey ? <p className="settings-note" role="status" aria-live="polite">{props.t(statusKey)}</p> : null}
        <div className="settings-inline-actions">
          <button
            ref={installTriggerRef}
            className="settings-button primary settings-action"
            type="button"
            aria-expanded={installOpen}
            aria-controls="skill-url-install"
            disabled={lifecycleAction !== null || uninstallConfirmation !== null}
            onClick={() => {
              setInstallOpen(true);
              setStatusKey(null);
              pendingFocusRef.current = "url";
            }}
          >
            <PigeIcon name="link" size={15} aria-hidden="true" />
            {props.t("skills.installFromLink")}
          </button>
          <button className="settings-button settings-action" type="button" disabled title={props.t("skills.chooseFileUnavailable")}>
            <PigeIcon name="fileText" size={15} aria-hidden="true" />
            {props.t("skills.chooseFile")}
          </button>
        </div>
        {installOpen ? (
          <div className="settings-card" id="skill-url-install">
            {stagedReview ? (
              <div className="settings-row tall">
                <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="skill" size={17} /></span>
                <div className="settings-row-copy">
                  <strong>{stagedReview.staged.name}</strong>
                  <span>{stagedReview.staged.description}</span>
                  <div className="skill-registry-meta" aria-label={props.t("skills.reviewDetails")}>
                    <span>{`v${stagedReview.staged.version}`}</span>
                    {stagedReview.staged.author ? <span>{stagedReview.staged.author}</span> : null}
                    {stagedReview.staged.license ? <span>{stagedReview.staged.license}</span> : null}
                    <span>{props.t("skills.scope.machine_local")}</span>
                    <span>{props.t("skills.boundary.local")}</span>
                  </div>
                  <span>{stagedReview.staged.sourceUrl}</span>
                  <span>{`${stagedReview.staged.files[0].relativePath} · ${formatByteSize(stagedReview.staged.files[0].utf8ByteSize)}`}</span>
                  {stagedReview.staged.capabilities.map((capability) => (
                    <span key={capability}>{props.t(`skills.capability.${capability}`)}</span>
                  ))}
                  {stagedReview.staged.warnings.map((warning) => (
                    <span role="status" key={warning}>{props.t(`skills.warning.${warning}`)}</span>
                  ))}
                </div>
                <div className="settings-row-control skill-registry-control">
                  <button
                    ref={stagedPrimaryActionRef}
                    className="settings-button primary"
                    type="button"
                    disabled={installBusy !== null || lifecycleAction !== null || uninstallConfirmation !== null}
                    onClick={() => void installStaged()}
                  >
                    {props.t(installBusy === "install"
                      ? stagedReview.kind === "update" ? "skills.updating" : "skills.installing"
                      : stagedReview.kind === "update" ? "skills.updateReviewed" : "skills.installReviewed")}
                  </button>
                  <button className="settings-button" type="button" disabled={installBusy !== null || lifecycleAction !== null || uninstallConfirmation !== null} onClick={() => void discardStaged()}>
                    {props.t(installBusy === "discard" ? "skills.discarding" : "skills.discardReview")}
                  </button>
                </div>
              </div>
            ) : (
              <form
                className="settings-row tall"
                onSubmit={(event) => {
                  event.preventDefault();
                  void stageFromUrl();
                }}
              >
                <div className="settings-row-copy">
                  <label htmlFor="skill-install-url"><strong>{props.t("skills.installUrlLabel")}</strong></label>
                  <span>{props.t("skills.installUrlDescription")}</span>
                </div>
                <input
                  ref={installUrlRef}
                  className="settings-input"
                  id="skill-install-url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={installUrl}
                  placeholder={props.t("skills.installUrlPlaceholder")}
                  disabled={installBusy !== null || lifecycleAction !== null || uninstallConfirmation !== null}
                  onInput={(event) => {
                    setInstallUrl(event.currentTarget.value);
                    setStatusKey(null);
                  }}
                />
                <div className="settings-row-control skill-registry-control">
                  <button className="settings-button primary" type="submit" disabled={installBusy !== null || lifecycleAction !== null || uninstallConfirmation !== null || installUrl.length === 0}>
                    {props.t(installBusy === "stage" ? "skills.reviewing" : "skills.reviewLink")}
                  </button>
                  <button className="settings-button" type="button" disabled={installBusy !== null || lifecycleAction !== null || uninstallConfirmation !== null} onClick={closeInstall}>
                    {props.t("skills.cancelInstall")}
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </section>

      <section className="settings-section" role="group" aria-labelledby="skills-review-title">
        <h2 className="settings-section-title" id="skills-review-title">{props.t("skills.reviewTitle")}</h2>
        <div className="settings-card">
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="fileText" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.reviewMetadata")}</strong>
              <span>{props.t("skills.reviewMetadataDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="shield" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.reviewPermissions")}</strong>
              <span>{props.t("skills.reviewPermissionsDescription")}</span>
            </div>
          </div>
          <div className="settings-row tall skills-information-row">
            <span className="settings-list-icon neutral" aria-hidden="true"><PigeIcon name="folder" size={17} /></span>
            <div className="settings-row-copy">
              <strong>{props.t("skills.scopeTitle")}</strong>
              <span>{props.t("skills.scopeDescription")}</span>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}

function createSkillInstallRequestId(): `skillreq_${string}` {
  return `skillreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createSkillLifecycleRequestId(): `skill_lifecycle_request_${string}` {
  return `skill_lifecycle_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function matchesLifecycleIdentity(
  result: SkillLifecycleMutationResult | SkillExportResult | SkillStageUpdateResult,
  requestId: string,
  activeVaultId: string,
  skillId: string
): boolean {
  return result.requestId === requestId && result.activeVaultId === activeVaultId && result.skillId === skillId;
}

function deferFocus(callback: () => void): void {
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
  } else {
    window.setTimeout(callback, 0);
  }
}

function invalidStageStatusKey(reason: SkillStageInvalidReason): string {
  return `skills.invalid.${reason}`;
}

function formatByteSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;
}
