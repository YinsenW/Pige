import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  BackupRestoreStatus,
  JobSummary,
  RecentVaultSummary,
  RestoreMode,
  RestorePreviewResult,
  RestorePreviewWarning,
  VaultRevealTarget,
  VaultSummary
} from "@pige/contracts";
import type { Locale, SourceStorageStrategy } from "@pige/schemas";
import {
  BackupDestinationReconnectAction,
  type BackupDestinationReconnectOutcome
} from "./BackupDestinationReconnectAction";
import { VaultStorageRelocationAction } from "./VaultStorageRelocationAction";

type ReadyRestorePreview = Extract<RestorePreviewResult, { readonly status: "ready" }>;
type RestorePhase = "idle" | "previewing" | "applying" | "cancelling" | "finishing";

function restoreWarningMessageKey(code: RestorePreviewWarning["code"]): string {
  switch (code) {
    case "invalid_archive_entries": return "backup.warningInvalidArchiveEntries";
    case "excluded_rebuildable_roots": return "backup.warningExcludedRebuildableRoots";
    case "external_originals_not_included": return "backup.warningExternalOriginalsNotIncluded";
  }
}

function restoreDefaultMode(preview: ReadyRestorePreview): RestoreMode | null {
  if (preview.permittedModes.includes("clone_as_new")) return "clone_as_new";
  if (preview.permittedModes.includes(preview.defaultMode)) return preview.defaultMode;
  return preview.permittedModes[0] ?? null;
}

export function useRestoreFlow(onRestored: () => Promise<void>, onRestoreStart: () => void) {
  const [restorePreview, setRestorePreview] = useState<ReadyRestorePreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode | null>(null);
  const [restorePhase, setRestorePhase] = useState<RestorePhase>("idle");
  const [restoreErrorKey, setRestoreErrorKey] = useState<string | null>(null);
  const restoreInFlight = useRef(false);
  const cancelInFlight = useRef(false);
  const activeRestoreIdentity = useRef<{ readonly previewId: string; readonly mode: RestoreMode } | null>(null);
  const pendingRestoreFocus = useRef<RefObject<HTMLButtonElement | null> | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const applyButtonRef = useRef<HTMLButtonElement>(null);

  const commitRestoreFocus = (): void => {
    if (!pendingRestoreFocus.current) return;
    const control = pendingRestoreFocus.current;
    pendingRestoreFocus.current = null;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => control.current?.focus());
    });
  };

  const restoreFocus = (control: RefObject<HTMLButtonElement | null>): void => {
    pendingRestoreFocus.current = control;
  };

  const previewRestore = async (): Promise<void> => {
    if (restoreInFlight.current) return;
    restoreInFlight.current = true;
    onRestoreStart();
    setRestorePreview(null);
    setRestoreMode(null);
    setRestoreErrorKey(null);
    setRestorePhase("previewing");
    try {
      const result = await window.pige.backup.previewRestore();
      if (result.status === "canceled") {
        restoreFocus(previewButtonRef);
        return;
      }
      const mode = restoreDefaultMode(result);
      if (!mode) {
        setRestoreErrorKey("backup.restoreFailed");
        restoreFocus(previewButtonRef);
        return;
      }
      setRestorePreview(result);
      setRestoreMode(mode);
    } catch {
      setRestoreErrorKey("backup.restoreFailed");
      restoreFocus(previewButtonRef);
    } finally {
      restoreInFlight.current = false;
      setRestorePhase("idle");
      commitRestoreFocus();
    }
  };

  const applyRestore = async (): Promise<void> => {
    if (
      restoreInFlight.current || !restorePreview || !restoreMode ||
      restorePreview.invalidFileCount > 0 || !restorePreview.permittedModes.includes(restoreMode)
    ) return;
    restoreInFlight.current = true;
    onRestoreStart();
    setRestoreErrorKey(null);
    setRestorePhase("applying");
    const identity = { previewId: restorePreview.previewId, mode: restoreMode } as const;
    activeRestoreIdentity.current = identity;
    try {
      const result = await window.pige.backup.applyRestore(identity);
      if (result.status === "canceled") {
        setRestorePreview(null);
        setRestoreMode(null);
        restoreFocus(previewButtonRef);
        return;
      }
      setRestorePreview(null);
      setRestoreMode(null);
      await onRestored();
    } catch {
      setRestoreErrorKey("backup.restoreFailed");
      restoreFocus(restorePreview ? applyButtonRef : previewButtonRef);
    } finally {
      if (activeRestoreIdentity.current === identity) activeRestoreIdentity.current = null;
      restoreInFlight.current = false;
      setRestorePhase("idle");
      commitRestoreFocus();
    }
  };

  const cancelRestore = async (): Promise<void> => {
    const active = activeRestoreIdentity.current;
    if (active && restoreInFlight.current) {
      if (cancelInFlight.current) return;
      cancelInFlight.current = true;
      setRestoreErrorKey(null);
      setRestorePhase("cancelling");
      try {
        const result = await window.pige.backup.cancelRestore({
          apiVersion: 1,
          requestId: `restorecancelreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
          ...active
        });
        if (result.status === "too_late") {
          setRestoreErrorKey("backup.restoreCancelTooLate");
          setRestorePhase("finishing");
        } else if (result.status !== "cancel_requested" && result.status !== "cancelled") {
          setRestoreErrorKey("backup.restoreCancelFailed");
          setRestorePhase("applying");
        }
      } catch {
        setRestoreErrorKey("backup.restoreCancelFailed");
        setRestorePhase("applying");
      } finally {
        cancelInFlight.current = false;
      }
      return;
    }
    if (restoreInFlight.current) return;
    setRestorePreview(null);
    setRestoreMode(null);
    setRestoreErrorKey(null);
    restoreFocus(previewButtonRef);
    commitRestoreFocus();
  };

  const selectRestoreMode = (mode: RestoreMode): void => {
    if (!restorePreview?.permittedModes.includes(mode) || restoreInFlight.current) return;
    setRestoreMode(mode);
    setRestoreErrorKey(null);
  };

  return {
    applyButtonRef,
    applyRestore,
    cancelRestore,
    previewButtonRef,
    previewRestore,
    restoreErrorKey,
    restoreMode,
    restorePhase,
    restorePreview,
    selectRestoreMode
  };
}

export function RestorePreviewPanel(props: {
  readonly idPrefix: string;
  readonly variant?: "first-run" | "settings";
  readonly locale?: Locale;
  readonly preview: ReadyRestorePreview;
  readonly mode: RestoreMode | null;
  readonly phase: RestorePhase;
  readonly errorKey: string | null;
  readonly applyButtonRef: RefObject<HTMLButtonElement | null>;
  readonly onModeChange: (mode: RestoreMode) => void;
  readonly onApply: () => Promise<void>;
  readonly onCancel: () => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const applying = props.phase === "applying";
  const cancelling = props.phase === "cancelling";
  const finishing = props.phase === "finishing";
  const restoreActive = applying || cancelling || finishing;
  const settingsVariant = props.variant === "settings";
  const applyDisabled = props.phase !== "idle" || props.mode === null ||
    props.preview.invalidFileCount > 0 || !props.preview.permittedModes.includes(props.mode);
  const locale = props.locale === "zh-Hans" ? "zh-CN" : props.locale;
  const createdAt = (() => {
    if (!settingsVariant || !locale) return props.preview.manifest.createdAt;
    const parsed = new Date(props.preview.manifest.createdAt);
    return Number.isNaN(parsed.getTime()) ? props.preview.manifest.createdAt :
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  })();
  const formatCount = (value: number): string => settingsVariant && locale
    ? value.toLocaleString(locale) : String(value);
  const warningCategoryCount = props.preview.warnings.length + (props.preview.invalidFileCount > 0 ? 1 : 0);

  const summary = (
    <dl className={settingsVariant ? "restore-settings-summary" : "restore-summary"}>
      {settingsVariant ? <>
        <div className="settings-row">
          <div className="settings-row-copy"><dt>{props.t("backup.createdAt")}</dt><dd>{createdAt}</dd></div>
          <span className="settings-badge">{props.preview.manifest.appVersion}</span>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <dt>{props.t("backup.vaultSchema")}</dt>
            <dd>{props.t("backup.vaultSchemaSummary")
              .replace("{version}", String(props.preview.manifest.vaultSchemaVersion))
              .replace("{notes}", formatCount(props.preview.manifest.noteCount))
              .replace("{sources}", formatCount(props.preview.manifest.sourceCount))
              .replace("{memories}", formatCount(props.preview.manifest.memoryCount))}</dd>
          </div>
          <span className={`settings-status${props.preview.invalidFileCount > 0 ? " warning" : ""}`}>
            {props.t(props.preview.invalidFileCount > 0 ? "backup.restoreBlocked" : "backup.restoreReady")}
          </span>
        </div>
        <div className="settings-row tall">
          <div className="settings-row-copy">
            <dt>{props.t("backup.warnings")}</dt>
            <dd>{warningCategoryCount === 0 ? props.t("backup.noWarnings") : (
              <ul className="restore-warning-list">
                {props.preview.invalidFileCount > 0 ? <li>
                  <span>{props.t("backup.invalidFiles")}</span>
                  <strong>{formatCount(props.preview.invalidFileCount)}</strong>
                </li> : null}
                {props.preview.warnings.map((warning) => <li key={warning.code}>
                  <span>{props.t(restoreWarningMessageKey(warning.code))}</span>
                  <strong>{formatCount(warning.count)}</strong>
                </li>)}
              </ul>
            )}</dd>
          </div>
          <span className="settings-badge">
            {props.t("backup.warningCategoryCount").replace("{count}", formatCount(warningCategoryCount))}
          </span>
        </div>
      </> : <>
        <div className="info-row"><dt>{props.t("backup.vault")}</dt><dd>{props.preview.manifest.vaultName}</dd></div>
        <div className="info-row"><dt>{props.t("backup.createdAt")}</dt><dd>{createdAt}</dd></div>
        <div className="info-row"><dt>{props.t("backup.appVersion")}</dt><dd>{props.preview.manifest.appVersion}</dd></div>
        <div className="info-row"><dt>{props.t("backup.vaultSchemaVersion")}</dt><dd>{props.preview.manifest.vaultSchemaVersion}</dd></div>
        <div className="info-row"><dt>{props.t("counts.notes")}</dt><dd>{props.preview.manifest.noteCount}</dd></div>
        <div className="info-row"><dt>{props.t("counts.sources")}</dt><dd>{props.preview.manifest.sourceCount}</dd></div>
        <div className="info-row"><dt>{props.t("backup.conversations")}</dt><dd>{props.preview.manifest.conversationCount}</dd></div>
        <div className="info-row"><dt>{props.t("backup.memories")}</dt><dd>{props.preview.manifest.memoryCount}</dd></div>
        <div className="info-row"><dt>{props.t("backup.invalidFiles")}</dt><dd>{props.preview.invalidFileCount}</dd></div>
        <div className="info-row"><dt>{props.t("backup.warnings")}</dt><dd>
          {props.preview.warnings.length === 0 ? props.t("backup.noWarnings") : (
            <ul className="restore-warning-list">{props.preview.warnings.map((warning) => <li key={warning.code}>
              <span>{props.t(restoreWarningMessageKey(warning.code))}</span><strong>{warning.count}</strong>
            </li>)}</ul>
          )}
        </dd></div>
      </>}
    </dl>
  );

  const modeOptions = (
    <fieldset className={settingsVariant ? "restore-mode-options settings-restore-modes" : "restore-mode-options"}>
      <legend className={settingsVariant ? "visually-hidden" : undefined}>{props.t("backup.restoreMode")}</legend>
      {props.preview.permittedModes.includes("clone_as_new") ? (
        <label className={settingsVariant ? `settings-radio${props.mode === "clone_as_new" ? " active" : ""}` : undefined}
          htmlFor={`${props.idPrefix}-restore-clone`}>
          <input id={`${props.idPrefix}-restore-clone`} type="radio" name={`${props.idPrefix}-restore-mode`}
            value="clone_as_new" checked={props.mode === "clone_as_new"} disabled={props.phase !== "idle"}
            onChange={() => props.onModeChange("clone_as_new")} />
          {settingsVariant ? <span className="settings-radio-mark" aria-hidden="true" /> : null}
          <span className={settingsVariant ? "settings-radio-copy" : undefined}>
            <strong>{props.t("backup.modeClone")}</strong><small>{props.t("backup.modeCloneDescription")}</small>
          </span>
        </label>
      ) : null}
      {props.preview.permittedModes.includes("replace_existing") ? (
        <label className={settingsVariant ? `settings-radio${props.mode === "replace_existing" ? " active" : ""}` : undefined}
          htmlFor={`${props.idPrefix}-restore-replace`}>
          <input id={`${props.idPrefix}-restore-replace`} type="radio" name={`${props.idPrefix}-restore-mode`}
            value="replace_existing" checked={props.mode === "replace_existing"} disabled={props.phase !== "idle"}
            onChange={() => props.onModeChange("replace_existing")} />
          {settingsVariant ? <span className="settings-radio-mark" aria-hidden="true" /> : null}
          <span className={settingsVariant ? "settings-radio-copy" : undefined}>
            <strong>{props.t("backup.modeReplace")}</strong><small>{props.t("backup.modeReplaceDescription")}</small>
          </span>
        </label>
      ) : null}
    </fieldset>
  );

  const feedback = <>
    {props.mode === "replace_existing" ? <p className={settingsVariant ? "settings-warning" : "restore-warning"} role="note">
      {props.t("backup.replaceWarning")}
    </p> : settingsVariant ? <p className="settings-warning" role="note">{props.t("backup.restorePrivacyWarning")}</p> : null}
    {props.preview.invalidFileCount > 0 ? <p className="error" role="alert">{props.t("backup.restoreInvalid")}</p> : null}
    {props.errorKey ? <p
      className={props.errorKey === "backup.restoreCancelTooLate" ? "muted" : "error"}
      role={props.errorKey === "backup.restoreCancelTooLate" ? "status" : "alert"}
    >{props.t(props.errorKey)}</p> : null}
    {restoreActive ? <p className="muted" role="status">
      {props.t(cancelling ? "backup.restoreStopping" : "backup.restoreProgress")}
    </p> : null}
  </>;
  const actions = <div className={settingsVariant ? "settings-inline-actions restore-settings-actions" : "settings-actions"}>
    {settingsVariant ? <button type="button" className="settings-button" disabled={props.phase === "previewing" || cancelling || finishing} onClick={() => void props.onCancel()}>
      {props.t(cancelling ? "backup.restoreStopping" : "backup.restoreCancel")}
    </button> : null}
    <button ref={props.applyButtonRef} type="button" className={settingsVariant ? "settings-button primary" : undefined}
      disabled={applyDisabled} onClick={() => void props.onApply()}>
      {restoreActive ? props.t("backup.restoring") : props.t(props.mode === "replace_existing" ? "backup.applyReplace" : "backup.applyClone")}
    </button>
    {!settingsVariant ? <button type="button" className="secondary" disabled={props.phase === "previewing" || cancelling || finishing} onClick={() => void props.onCancel()}>
      {props.t(cancelling ? "backup.restoreStopping" : "backup.restoreCancel")}
    </button> : null}
  </div>;

  if (settingsVariant) return (
    <section className="settings-page settings-restore-page restore-preview" aria-labelledby={`${props.idPrefix}-restore-title`}>
      <header className="settings-panel-header">
        <button className="settings-button restore-back-button" type="button" disabled={props.phase !== "idle"} onClick={props.onCancel}>
          {props.t("backup.backToVault")}
        </button>
        <h1 id={`${props.idPrefix}-restore-title`}>{props.t("backup.restorePageTitle")}</h1>
        <p>{props.t("backup.restorePageSubtitle")}</p>
      </header>
      <section className="settings-section" aria-labelledby={`${props.idPrefix}-preview-title`}>
        <h2 className="settings-section-title" id={`${props.idPrefix}-preview-title`}>{props.t("backup.restorePreview")}</h2>
        <div className="settings-card">{summary}</div>
      </section>
      <section className="settings-section" aria-labelledby={`${props.idPrefix}-identity-title`}>
        <h2 className="settings-section-title" id={`${props.idPrefix}-identity-title`}>{props.t("backup.identityMode")}</h2>
        {modeOptions}{feedback}
      </section>
      {actions}
    </section>
  );
  return <section className="restore-preview" aria-label={props.t("backup.restorePreview")}>
    <strong>{props.t("backup.restorePreview")}</strong>{summary}{modeOptions}{feedback}{actions}
  </section>;
}

function backupJobMessageKey(job: JobSummary): string {
  if (job.state === "queued" || job.state === "running") return "backup.running";
  if (job.state === "cancel_requested") return "backup.cancelRequested";
  if (job.state === "waiting_dependency" && job.canReconnectBackupDestination === true) {
    return "backup.waitingDestinationReconnect";
  }
  if (job.state === "waiting_dependency") return "backup.waitingManagedSourceReconnect";
  if (job.state === "failed_retryable" && job.error?.userAction === "retry") return "backup.failedRetryable";
  return "backup.failedFinal";
}

type ReconnectNotice = { readonly kind: "status" | "error"; readonly key: string };

export type BackupContinueIncompleteOutcome = "continued" | "cancelled" | "stale" | "not_found" | "ineligible" | "failed";

export function BackupContinueIncompleteAction(props: {
  readonly identityKey: string;
  readonly eligible: boolean;
  readonly disabled?: boolean;
  readonly labels: {
    readonly action: string;
    readonly confirmation: string;
    readonly confirm: string;
    readonly cancel: string;
    readonly pending: string;
    readonly continued: string;
    readonly stale: string;
    readonly failed: string;
  };
  readonly onContinue: () => Promise<BackupContinueIncompleteOutcome>;
  readonly onContinued: () => Promise<void>;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string } | null>(null);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousEligibleRef = useRef(props.eligible);

  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
      (triggerRef.current ?? props.returnFocusRef.current)?.focus()));
  };

  useEffect(() => {
    const lostEligibility = previousEligibleRef.current && !props.eligible;
    previousEligibleRef.current = props.eligible;
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setConfirming(false);
    setPending(false);
    props.onPendingChange?.(false);
    setNotice(null);
    if (lostEligibility) restoreFocus();
  }, [props.eligible, props.identityKey]);

  useEffect(() => {
    if (!confirming) return;
    window.requestAnimationFrame(() => confirmRef.current?.focus());
  }, [confirming]);

  const cancel = (): void => {
    if (requestActiveRef.current) return;
    setConfirming(false);
    setNotice(null);
    restoreFocus();
  };

  const continueBackup = async (): Promise<void> => {
    if (!props.eligible || props.disabled || requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const identityKey = props.identityKey;
    setPending(true);
    props.onPendingChange?.(true);
    setNotice(null);
    try {
      const outcome = await props.onContinue();
      if (sequence !== requestSequenceRef.current || identityKey !== props.identityKey) return;
      setConfirming(false);
      if (outcome === "continued") {
        setNotice({ kind: "status", text: props.labels.continued });
        await props.onContinued().catch(() => undefined);
      } else if (outcome === "cancelled") setNotice(null);
      else if (outcome === "stale" || outcome === "not_found" || outcome === "ineligible") {
        setNotice({ kind: "error", text: props.labels.stale });
      } else setNotice({ kind: "error", text: props.labels.failed });
    } catch {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        setConfirming(false);
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } finally {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        requestActiveRef.current = false;
        setPending(false);
        props.onPendingChange?.(false);
        restoreFocus();
      }
    }
  };

  if (!props.eligible) return null;
  return <div className="settings-row-control">
    {confirming ? <div role="group" aria-label={props.labels.confirmation} className="settings-row-control">
      <span className="settings-status">{props.labels.confirmation}</span>
      <button ref={confirmRef} className="settings-button primary" type="button" disabled={pending} aria-busy={pending || undefined}
        onClick={() => void continueBackup()}>{pending ? props.labels.pending : props.labels.confirm}</button>
      <button className="settings-button" type="button" disabled={pending} onClick={cancel}>{props.labels.cancel}</button>
    </div> : <button ref={triggerRef} className="settings-button" type="button" disabled={props.disabled}
      onClick={() => { setNotice(null); setConfirming(true); }}>{props.labels.action}</button>}
    {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
      role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</span> : null}
  </div>;
}

export type ManagedCopyRootSelectionOutcome = "selected" | "cancelled" | "stale" | "not_found" | "ineligible" | "failed";

export function ManagedCopyRootSelectionAction(props: {
  readonly identityKey: string;
  readonly eligible: boolean;
  readonly disabled?: boolean;
  readonly labels: {
    readonly action: string;
    readonly pending: string;
    readonly selected: string;
    readonly stale: string;
    readonly failed: string;
  };
  readonly onSelect: () => Promise<ManagedCopyRootSelectionOutcome>;
  readonly onSelected: () => Promise<void>;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}): React.JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string } | null>(null);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousEligibleRef = useRef(props.eligible);
  const previousIdentityRef = useRef(props.identityKey);

  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
      (triggerRef.current ?? props.returnFocusRef.current)?.focus()));
  };

  useEffect(() => {
    const lostEligibility = previousEligibleRef.current && !props.eligible;
    const identityChanged = previousIdentityRef.current !== props.identityKey;
    const wasActive = requestActiveRef.current;
    previousEligibleRef.current = props.eligible;
    previousIdentityRef.current = props.identityKey;
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setPending(false);
    props.onPendingChange?.(false);
    setNotice(null);
    if (lostEligibility || (identityChanged && wasActive)) restoreFocus();
  }, [props.eligible, props.identityKey]);

  const selectRoot = async (): Promise<void> => {
    if (!props.eligible || props.disabled || requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const identityKey = props.identityKey;
    setPending(true);
    props.onPendingChange?.(true);
    setNotice(null);
    try {
      const outcome = await props.onSelect();
      if (sequence !== requestSequenceRef.current || identityKey !== props.identityKey) return;
      if (outcome === "selected") {
        setNotice({ kind: "status", text: props.labels.selected });
        await props.onSelected().catch(() => undefined);
      } else if (outcome === "cancelled") setNotice(null);
      else if (outcome === "stale" || outcome === "not_found" || outcome === "ineligible") {
        setNotice({ kind: "error", text: props.labels.stale });
      } else setNotice({ kind: "error", text: props.labels.failed });
    } catch {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } finally {
      if (sequence === requestSequenceRef.current && identityKey === props.identityKey) {
        requestActiveRef.current = false;
        setPending(false);
        props.onPendingChange?.(false);
        restoreFocus();
      }
    }
  };

  if (!props.eligible) return null;
  return <div className="settings-row-control">
    <button ref={triggerRef} className="settings-button" type="button" disabled={props.disabled || pending}
      aria-busy={pending || undefined} onClick={() => void selectRoot()}>{pending ? props.labels.pending : props.labels.action}</button>
    {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
      role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</span> : null}
  </div>;
}

export interface VaultBackupSettingsPanelProps {
  readonly locale: Locale;
  readonly busy: boolean;
  readonly error: string | null;
  readonly vault: VaultSummary;
  readonly backupStatus: BackupRestoreStatus | null;
  readonly backupJobs: readonly JobSummary[];
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onOpen: () => Promise<void>;
  readonly onCreate: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRefreshDiagnostics: () => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly onOpenMemory: () => void;
  readonly onError: (error: string | null) => void;
  readonly t: (key: string) => string;
}

export function VaultBackupSettingsPanel(props: VaultBackupSettingsPanelProps): React.JSX.Element {
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [relocationBusy, setRelocationBusy] = useState(false);
  const [reconnectNotice, setReconnectNotice] = useState<ReconnectNotice | null>(null);
  const [revealTarget, setRevealTarget] = useState<VaultRevealTarget | null>(null);
  const [revealNotice, setRevealNotice] = useState<{ readonly kind: "success" | "error"; readonly message: string } | null>(null);
  const revealRequestSequence = useRef(0);
  const revealRequestActiveRef = useRef(false);
  const reconnectRequestSequence = useRef(0);
  const reconnectRequestActiveRef = useRef(false);
  const reconnectButtonRef = useRef<HTMLButtonElement>(null);
  const backupSectionRef = useRef<HTMLElement>(null);
  const knowledgeRootButtonRef = useRef<HTMLButtonElement>(null);
  const sourceAssetRootButtonRef = useRef<HTMLButtonElement>(null);
  const activeBackupJob = props.backupJobs[0];
  const reconnectIdentityRef = useRef({ vaultId: props.vault.vaultId, jobId: activeBackupJob?.id ?? null });
  reconnectIdentityRef.current = { vaultId: props.vault.vaultId, jobId: activeBackupJob?.id ?? null };
  const lastBackupDisplay = props.backupStatus?.lastBackupAt
    ? new Intl.DateTimeFormat(props.locale === "zh-Hans" ? "zh-CN" : props.locale, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(props.backupStatus.lastBackupAt))
    : props.t("backup.never");
  const restore = useRestoreFlow(async () => {
    setBackupNotice(props.t("backup.restored"));
    await props.onRefresh();
    await props.onRefreshDiagnostics();
  }, () => props.onError(null));

  useEffect(() => () => {
    revealRequestSequence.current += 1;
    reconnectRequestSequence.current += 1;
    revealRequestActiveRef.current = false;
    reconnectRequestActiveRef.current = false;
  }, []);

  useEffect(() => {
    reconnectRequestSequence.current += 1;
    reconnectRequestActiveRef.current = false;
    setReconnectNotice(null);
    setBackupBusy(false);
    setRelocationBusy(false);
  }, [props.vault.vaultId, activeBackupJob?.id]);

  const runBackupAction = async (action: () => Promise<void>): Promise<void> => {
    props.onError(null);
    setBackupNotice(null);
    setBackupBusy(true);
    try { await action(); }
    catch {
      setBackupNotice(props.t("backup.actionFailed"));
      await props.onRefresh().catch(() => undefined);
    } finally { setBackupBusy(false); }
  };

  useEffect(() => {
    if (!backupBusy) return;
    const timer = window.setInterval(() => void props.onRefresh(), 1_200);
    return () => window.clearInterval(timer);
  }, [backupBusy, props.onRefresh]);

  useEffect(() => {
    if (activeBackupJob) setBackupNotice(null);
  }, [activeBackupJob?.id, activeBackupJob?.state]);

  const createBackup = async (): Promise<void> => runBackupAction(async () => {
    const result = await window.pige.backup.create();
    if (result.status === "created" && result.manifest) {
      setBackupNotice(`${props.t("backup.created")}: ${result.manifest.fileCount}`);
      await props.onRefresh();
    }
  });
  const cancelBackup = async (): Promise<void> => runBackupAction(async () => {
    if (!activeBackupJob) return;
    await window.pige.jobs.cancel({ jobId: activeBackupJob.id });
    await props.onRefresh();
  });
  const retryBackup = async (): Promise<void> => runBackupAction(async () => {
    if (!activeBackupJob) return;
    await window.pige.jobs.retry({ jobId: activeBackupJob.id });
    await props.onRefresh();
  });

  const reconnectDependency = async (): Promise<void> => {
    if (props.busy || backupBusy || relocationBusy || reconnectRequestActiveRef.current || activeBackupJob?.canReconnectDependency !== true) return;
    const identity = { vaultId: props.vault.vaultId, jobId: activeBackupJob.id };
    const sequence = ++reconnectRequestSequence.current;
    reconnectRequestActiveRef.current = true;
    setBackupBusy(true);
    setReconnectNotice({ kind: "status", key: "backup.reconnectManagedSourceChecking" });
    try {
      const result = await window.pige.backup.reconnectDependency({
        apiVersion: 1,
        requestId: `backupreconnectreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: identity.vaultId,
        waitingJobId: identity.jobId
      });
      const current = reconnectIdentityRef.current;
      if (sequence !== reconnectRequestSequence.current || current.vaultId !== identity.vaultId || current.jobId !== identity.jobId
        || result.activeVaultId !== identity.vaultId || result.waitingJobId !== identity.jobId) return;
      if (result.status === "resolved") {
        setReconnectNotice({ kind: "status", key: "backup.reconnectManagedSourceResolved" });
        await props.onRefresh().catch(() => undefined);
      } else if (result.status === "cancelled") setReconnectNotice(null);
      else if (result.status === "stale" || result.status === "not_found") {
        setReconnectNotice({ kind: "error", key: "backup.reconnectManagedSourceStale" });
      } else setReconnectNotice({ kind: "error", key: "backup.reconnectManagedSourceFailed" });
    } catch {
      const current = reconnectIdentityRef.current;
      if (sequence === reconnectRequestSequence.current && current.vaultId === identity.vaultId && current.jobId === identity.jobId) {
        setReconnectNotice({ kind: "error", key: "backup.reconnectManagedSourceFailed" });
      }
    } finally {
      const current = reconnectIdentityRef.current;
      if (sequence === reconnectRequestSequence.current && current.vaultId === identity.vaultId && current.jobId === identity.jobId) {
        reconnectRequestActiveRef.current = false;
        setBackupBusy(false);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
          (reconnectButtonRef.current ?? backupSectionRef.current)?.focus()));
      }
    }
  };

  const continueIncompleteBackup = async (): Promise<BackupContinueIncompleteOutcome> => {
    if (!activeBackupJob || activeBackupJob.canContinueIncomplete !== true) return "ineligible";
    const result = await window.pige.backup.continueIncomplete({
      apiVersion: 1,
      requestId: `backupcontinuereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.vault.vaultId,
      waitingJobId: activeBackupJob.id,
      expectedJobUpdatedAt: activeBackupJob.updatedAt
    });
    return result.status;
  };

  const reconnectBackupDestination = async (): Promise<BackupDestinationReconnectOutcome> => {
    if (!activeBackupJob || activeBackupJob.canReconnectBackupDestination !== true) return "ineligible";
    const request = {
      apiVersion: 1 as const,
      requestId: `backupdestinationreconnectreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.vault.vaultId,
      waitingJobId: activeBackupJob.id,
      expectedJobUpdatedAt: activeBackupJob.updatedAt
    };
    const result = await window.pige.backup.reconnectDestination(request);
    if (result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId
      || result.waitingJobId !== request.waitingJobId
      || result.expectedJobUpdatedAt !== request.expectedJobUpdatedAt) return "stale";
    return result.status;
  };

  const configureManagedCopyRoot = async (): Promise<ManagedCopyRootSelectionOutcome> => {
    const managedCopyRoot = props.vault.managedCopyRoot;
    if (managedCopyRoot.canConfigure !== true) return "ineligible";
    const request = {
      apiVersion: 1 as const,
      requestId: `rootconfigreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.vault.vaultId,
      expectedSourceStorageRevision: managedCopyRoot.sourceStorageRevision
    };
    const result = await window.pige.vault.configureManagedCopyRoot(request);
    if (result.requestId !== request.requestId || result.activeVaultId !== request.activeVaultId
      || result.expectedSourceStorageRevision !== request.expectedSourceStorageRevision) return "stale";
    return result.status === "configured" ? "selected" : result.status;
  };

  const updatePolicy = async (defaultStrategy: SourceStorageStrategy): Promise<void> => {
    props.onError(null);
    try {
      await window.pige.vault.updateSourceStoragePolicy({ defaultStrategy });
      await props.onRefresh();
    } catch { props.onError(props.t("error.generic")); }
  };

  const revealStorageRoot = async (target: VaultRevealTarget): Promise<void> => {
    if (props.busy || revealRequestActiveRef.current) return;
    revealRequestActiveRef.current = true;
    const requestId = ++revealRequestSequence.current;
    setRevealTarget(target);
    setRevealNotice(null);
    try {
      const result = target === "knowledge_root"
        ? await window.pige.vault.revealKnowledgeRoot()
        : await window.pige.vault.revealSourceAssetRoot();
      if (requestId !== revealRequestSequence.current) return;
      setRevealNotice(result.status === "revealed"
        ? { kind: "success", message: props.t("vaultSettings.revealSucceeded") }
        : { kind: "error", message: props.t(result.error.messageKey) });
    } catch {
      if (requestId === revealRequestSequence.current) setRevealNotice({ kind: "error", message: props.t("errors.vault.reveal_failed") });
    } finally {
      if (requestId === revealRequestSequence.current) {
        revealRequestActiveRef.current = false;
        setRevealTarget(null);
        window.requestAnimationFrame(() => (target === "knowledge_root" ? knowledgeRootButtonRef.current : sourceAssetRootButtonRef.current)?.focus());
      }
    }
  };

  if (restore.restorePreview) return <RestorePreviewPanel idPrefix="vault-settings" variant="settings" locale={props.locale}
    preview={restore.restorePreview} mode={restore.restoreMode} phase={restore.restorePhase} errorKey={restore.restoreErrorKey}
    applyButtonRef={restore.applyButtonRef} onModeChange={restore.selectRestoreMode} onApply={restore.applyRestore}
    onCancel={restore.cancelRestore} t={props.t} />;

  return <section className="settings-page settings-vault-page" aria-labelledby="settings-vault-title">
    <header className="settings-panel-header"><h1 id="settings-vault-title">{props.t("vaultSettings.title")}</h1><p>{props.t("vaultSettings.subtitle")}</p></header>
    <div className="settings-summary-grid" aria-label={props.t("counts.title")}>
      {([[props.t("counts.notes"), props.vault.counts?.notes ?? 0], [props.t("counts.sources"), props.vault.counts?.sources ?? 0],
        [props.t("counts.managedCopies"), props.vault.counts?.managedSourceCopies ?? 0], [props.t("counts.referencedOriginals"), props.vault.counts?.referencedOriginals ?? 0]] as const)
        .map(([label, value]) => <div className="settings-summary" key={label}><strong>{value.toLocaleString(props.locale === "zh-Hans" ? "zh-CN" : props.locale)}</strong><span>{label}</span></div>)}
    </div>
    <section className="settings-section" aria-labelledby="vault-current-title">
      <h2 className="settings-section-title" id="vault-current-title">{props.t("vaultSettings.currentVault")}</h2>
      <div className="settings-card" aria-busy={relocationBusy || revealTarget ? "true" : undefined}>
        <div className="settings-row tall"><div className="settings-row-copy"><strong>{props.vault.name}</strong><span>{props.vault.activeVaultPathDisplay}</span></div><span className="settings-status">{props.t("vaultSettings.connected")}</span></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("vaultSettings.relocate")}</strong><span>{props.t("vaultSettings.relocateDescription")}</span></div><VaultStorageRelocationAction activeVaultId={props.vault.vaultId} disabled={props.busy || backupBusy || Boolean(revealTarget)} labels={{ action: props.t("vaultSettings.relocateAction"), pending: props.t("vaultSettings.relocating"), relocated: props.t("vaultSettings.relocated"), stale: props.t("vaultSettings.relocateStale"), blocked: props.t("vaultSettings.relocateBlocked"), destinationExists: props.t("vaultSettings.relocateDestinationExists"), failed: props.t("vaultSettings.relocateFailed") }} onPendingChange={setRelocationBusy} onRelocated={props.onRefresh} /></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("field.noteStorage")}</strong><span>{props.vault.knowledgeRootDisplay}</span></div><button ref={knowledgeRootButtonRef} className="settings-button settings-action" type="button" disabled={props.busy || relocationBusy || Boolean(revealTarget)} onClick={() => void revealStorageRoot("knowledge_root")}>{props.t("vaultSettings.openInFinder")}</button></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("field.sourceAssets")}</strong><span>{props.vault.sourceAssetRootDisplay}</span><span>{props.t(props.vault.managedCopyRoot.mode === "external_binding" ? "vaultSettings.managedCopyRoot.external" : "vaultSettings.managedCopyRoot.insideVault")} · {props.t(`vaultSettings.managedCopyRoot.${props.vault.managedCopyRoot.availability}`)}</span><span>{props.t("vaultSettings.managedCopyRoot.futureOnly")}</span></div><div className="settings-row-control"><button ref={sourceAssetRootButtonRef} className="settings-button settings-action" type="button" disabled={props.busy || relocationBusy || Boolean(revealTarget)} onClick={() => void revealStorageRoot("source_asset_root")}>{props.t("vaultSettings.openSourceAssets")}</button><ManagedCopyRootSelectionAction
          identityKey={`${props.vault.vaultId}:${props.vault.managedCopyRoot.sourceStorageRevision}`}
          eligible={props.vault.managedCopyRoot.canConfigure === true}
          disabled={props.busy || relocationBusy || Boolean(revealTarget)}
          labels={{
            action: props.t(props.vault.managedCopyRoot.mode === "external_binding" ? "vaultSettings.managedCopyRoot.change" : "vaultSettings.managedCopyRoot.choose"),
            pending: props.t("vaultSettings.managedCopyRoot.choosing"),
            selected: props.t("vaultSettings.managedCopyRoot.configured"),
            stale: props.t("vaultSettings.managedCopyRoot.stale"),
            failed: props.t("vaultSettings.managedCopyRoot.failed")
          }}
          onSelect={configureManagedCopyRoot}
          onSelected={props.onRefresh}
          returnFocusRef={sourceAssetRootButtonRef}
        /></div></div>
        <label className="settings-row" htmlFor="vault-source-storage-strategy"><span className="settings-row-copy"><strong>{props.t("sourceStorage.title")}</strong><span>{props.t("sourceStorage.description")}</span></span><select className="settings-select" id="vault-source-storage-strategy" value={props.vault.defaultSourceStorageStrategy} disabled={props.busy || relocationBusy || Boolean(revealTarget)} onChange={(event) => void updatePolicy(event.target.value as SourceStorageStrategy)}><option value="copy_to_source_library">{props.t("sourceStorage.copy")}</option><option value="reference_original">{props.t("sourceStorage.reference")}</option></select></label>
      </div>
      <div className="settings-inline-actions"><button type="button" className="settings-button" onClick={props.onOpen} disabled={props.busy || relocationBusy || Boolean(revealTarget)}>{props.t("vaultSettings.openAnother")}</button><button type="button" className="settings-button" onClick={props.onCreate} disabled={props.busy || relocationBusy || Boolean(revealTarget)}>{props.t("vaultSettings.createNew")}</button></div>
      {revealNotice ? <p className={revealNotice.kind === "error" ? "error" : "settings-note"} role="status" aria-live="polite">{revealNotice.message}</p> : null}
    </section>
    <section ref={backupSectionRef} tabIndex={-1} className="settings-section" aria-labelledby="vault-backup-title">
      <h2 className="settings-section-title" id="vault-backup-title">{props.t("backup.title")}</h2>
      <div className="settings-card">
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("backup.lastBackup")}</strong><span>{lastBackupDisplay} · {props.t("backup.excludesSecrets")}</span></div></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("backup.contents")}</strong><span>{props.backupStatus?.messageKey ? props.t(props.backupStatus.messageKey) : props.t("backup.loading")}</span></div><button className="settings-button" type="button" onClick={props.onOpenMemory}>{props.t("backup.viewMemory")}</button></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>{props.t("backup.protectKnowledge")}</strong><span>{props.t("backup.protectKnowledgeDescription")}</span></div><div className="settings-row-control"><button className="settings-button primary" type="button" disabled={backupBusy || relocationBusy || !props.backupStatus?.createAvailable} onClick={() => void createBackup()}>{props.t("backup.create")}</button><button ref={restore.previewButtonRef} className="settings-button" type="button" disabled={backupBusy || relocationBusy || restore.restorePhase !== "idle" || !props.backupStatus?.restoreAvailable} onClick={() => void restore.previewRestore()}>{props.t(restore.restorePhase === "previewing" ? "backup.opening" : "backup.restore")}</button></div></div>
        {activeBackupJob ? <div className="settings-row tall backup-job-status" role="status" aria-live="polite"><div className="settings-row-copy"><strong>{props.t("backup.currentJob")}</strong><span>{props.t(backupJobMessageKey(activeBackupJob))}</span></div><div className="settings-row-control">
          {activeBackupJob.state === "queued" || activeBackupJob.state === "running" ? <button type="button" className="settings-button" disabled={backupBusy || relocationBusy} onClick={() => void cancelBackup()}>{props.t("home.cancelJob")}</button>
            : activeBackupJob.state === "failed_retryable" && activeBackupJob.error?.userAction === "retry" ? <button type="button" className="settings-button" disabled={backupBusy || relocationBusy} onClick={() => void retryBackup()}>{props.t("home.retryJob")}</button>
              : activeBackupJob.canReconnectDependency === true ? <button ref={reconnectButtonRef} type="button" className="settings-button" disabled={backupBusy || relocationBusy} aria-busy={reconnectRequestActiveRef.current || undefined} onClick={() => void reconnectDependency()}>{props.t("backup.reconnectManagedSource")}</button>
                : activeBackupJob.canReconnectBackupDestination === true ? <BackupDestinationReconnectAction
                  identityKey={`${props.vault.vaultId}:${activeBackupJob.id}:${activeBackupJob.updatedAt}`}
                  eligible={activeBackupJob.canReconnectBackupDestination === true}
                  disabled={props.busy || backupBusy || relocationBusy}
                  labels={{
                    action: props.t("backup.reconnectDestination"),
                    pending: props.t("backup.reconnectDestinationChecking"),
                    reconnected: props.t("backup.reconnectDestinationReconnected"),
                    stale: props.t("backup.reconnectDestinationStale"),
                    failed: props.t("backup.reconnectDestinationFailed")
                  }}
                  onReconnect={reconnectBackupDestination}
                  onReconnected={props.onRefresh}
                  onPendingChange={setBackupBusy}
                  returnFocusRef={backupSectionRef}
                />
                : <BackupContinueIncompleteAction
                  identityKey={`${props.vault.vaultId}:${activeBackupJob.id}:${activeBackupJob.updatedAt}`}
                  eligible={activeBackupJob.canContinueIncomplete === true}
                  disabled={props.busy || backupBusy || relocationBusy}
                  labels={{
                    action: props.t("backup.continueIncomplete"),
                    confirmation: props.t("backup.continueIncompleteConfirmation"),
                    confirm: props.t("backup.continueIncompleteConfirm"),
                    cancel: props.t("backup.restoreCancel"),
                    pending: props.t("backup.continueIncompletePending"),
                    continued: props.t("backup.continueIncompleteContinued"),
                    stale: props.t("backup.continueIncompleteStale"),
                    failed: props.t("backup.continueIncompleteFailed")
                  }}
                  onContinue={continueIncompleteBackup}
                  onContinued={props.onRefresh}
                  onPendingChange={setBackupBusy}
                  returnFocusRef={backupSectionRef}
                />}
        </div></div> : null}
      </div>
      {reconnectNotice ? <p className={reconnectNotice.kind === "error" ? "error" : "muted"} role={reconnectNotice.kind === "error" ? "alert" : "status"} aria-live="polite">{props.t(reconnectNotice.key)}</p> : null}
      {backupNotice ? <p className="muted">{backupNotice}</p> : null}
      {!restore.restorePreview && restore.restoreErrorKey ? <p className="error" role="alert">{props.t(restore.restoreErrorKey)}</p> : null}
      <p className="settings-note">{props.t("backup.recentVaultNote")}</p>
    </section>
    <RecentVaults recentVaults={props.recentVaults} onRemoveRecent={props.onRemoveRecent} t={props.t} />
    {props.error ? <p className="error">{props.error}</p> : null}
  </section>;
}

export function RecentVaults(props: {
  readonly recentVaults: readonly RecentVaultSummary[];
  readonly onOpenRecent?: (vaultId: string) => Promise<void>;
  readonly onRemoveRecent: (vaultId: string) => Promise<void>;
  readonly openingVaultId?: string | null;
  readonly errorVaultId?: string | null;
  readonly disabled?: boolean;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.recentVaults.length === 0) return null;

  return (
    <section className="settings-section recent-list" aria-labelledby="recent-vaults-title">
      <h2 className="settings-section-title" id="recent-vaults-title">{props.t("recent.title")}</h2>
      <div className="settings-card">
        {props.recentVaults.map((recent) => (
          <div className="settings-row recent-vault-row" key={recent.vaultId}>
            <div className="settings-row-copy">
              <strong>{recent.name}</strong>
              <span>{recent.pathDisplay}</span>
              {props.errorVaultId === recent.vaultId ? (
                <span className="recent-vault-error" role="alert">{props.t("recent.openFailed")}</span>
              ) : null}
            </div>
            <div className="settings-row-control" role="group" aria-label={recent.name}>
              {props.onOpenRecent ? (
                <button
                  className="settings-button primary"
                  type="button"
                  aria-busy={props.openingVaultId === recent.vaultId}
                  aria-label={`${props.t("recent.open")}: ${recent.name}`}
                  disabled={props.disabled}
                  onClick={(event) => {
                    const button = event.currentTarget;
                    void props.onOpenRecent?.(recent.vaultId).finally(() => {
                      window.requestAnimationFrame(() => {
                        if (button.isConnected) button.focus();
                      });
                    });
                  }}
                >
                  {props.t(props.openingVaultId === recent.vaultId ? "recent.opening" : "recent.open")}
                </button>
              ) : null}
              <button
                className="settings-button"
                type="button"
                aria-label={`${props.t("recent.remove")}: ${recent.name}`}
                disabled={props.disabled}
                onClick={() => void props.onRemoveRecent(recent.vaultId)}
              >
                {props.t("recent.remove")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
