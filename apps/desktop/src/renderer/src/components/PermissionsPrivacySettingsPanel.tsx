import { useEffect, useRef, useState } from "react";
import type {
  PermissionDefaultMode,
  PermissionGrantSummary,
  PermissionPolicyChangedEvent,
  PermissionPolicySummary,
  PermissionPolicySummaryRequest,
  PermissionPolicySummaryResult,
  PermissionRevokeGrantRequest,
  PermissionRevokeGrantResult,
  PermissionSetDefaultModeRequest,
  PermissionSetDefaultModeResult,
  PermissionYoloHardBoundary
} from "@pige/contracts";

export interface PermissionPolicyApi {
  readonly summary: (request: PermissionPolicySummaryRequest) => Promise<PermissionPolicySummaryResult>;
  readonly setDefaultMode: (
    request: PermissionSetDefaultModeRequest
  ) => Promise<PermissionSetDefaultModeResult>;
  readonly revokeGrant: (
    request: PermissionRevokeGrantRequest
  ) => Promise<PermissionRevokeGrantResult>;
  readonly onChanged: (
    listener: (event: PermissionPolicyChangedEvent) => void
  ) => () => void;
}

type PermissionOperation =
  | { readonly kind: "mode"; readonly mode: PermissionDefaultMode }
  | { readonly kind: "grant"; readonly grantId: string }
  | { readonly kind: "all" };

export function PermissionsPrivacySettingsPanel(props: {
  readonly activeVaultId?: string | null;
  readonly api?: PermissionPolicyApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [current, setCurrent] = useState<PermissionPolicySummary | null>(null);
  const [notice, setNotice] = useState<
    "load_failed" | "confirmation_required" | "stale" | "failed" | null
  >(null);
  const [operation, setOperation] = useState<PermissionOperation | null>(null);
  const [fullAccessConfirming, setFullAccessConfirming] = useState(false);
  const [fullAccessAcknowledged, setFullAccessAcknowledged] = useState(false);
  const currentRef = useRef(current);
  const ownerRef = useRef(props.activeVaultId);
  const operationRef = useRef<PermissionOperation | null>(null);
  const focusRestoreRef = useRef<{ readonly trigger: HTMLElement; readonly mode?: PermissionDefaultMode } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const fullAccessTriggerRef = useRef<HTMLElement | null>(null);
  const fullAccessAcknowledgeRef = useRef<HTMLInputElement | null>(null);

  const applyCurrent = (next: PermissionPolicySummary): void => {
    if (next.activeVaultId !== ownerRef.current) return;
    if (currentRef.current && next.revision < currentRef.current.revision) return;
    currentRef.current = next;
    setCurrent(next);
  };

  useEffect(() => {
    ownerRef.current = props.activeVaultId;
    currentRef.current = null;
    operationRef.current = null;
    focusRestoreRef.current = null;
    setCurrent(null);
    setOperation(null);
    setNotice(null);
    setFullAccessConfirming(false);
    setFullAccessAcknowledged(false);
    if (!props.activeVaultId || !props.api) return;

    const activeVaultId = props.activeVaultId;
    let active = true;
    const unsubscribe = props.api.onChanged((next) => {
      if (!active || next.activeVaultId !== activeVaultId) return;
      applyCurrent(next);
      setNotice(null);
    });
    void props.api.summary({
      apiVersion: 1,
      requestId: createPermissionPolicyRequestId(),
      activeVaultId
    }).then((result) => {
      if (!active || ownerRef.current !== activeVaultId) return;
      if (result.status === "ready") applyCurrent(result.summary);
      else setNotice("load_failed");
    }).catch(() => {
      if (active && ownerRef.current === activeVaultId) setNotice("load_failed");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [props.activeVaultId, props.api]);

  useEffect(() => {
    if (!fullAccessConfirming) return;
    const focusAcknowledgement = (): void => fullAccessAcknowledgeRef.current?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusAcknowledgement);
    else window.setTimeout(focusAcknowledgement, 0);
  }, [fullAccessConfirming]);

  useEffect(() => {
    const pending = focusRestoreRef.current;
    if (!pending || operation !== null || (pending.mode && current?.defaultMode !== pending.mode)) return;
    focusRestoreRef.current = null;
    if (pending.trigger.isConnected) {
      pending.trigger.focus();
      return;
    }
    panelRef.current?.querySelector<HTMLElement>(
      'button:not(:disabled), input[name="privacy-permission-mode"]:checked'
    )?.focus();
  }, [current, operation]);

  const finish = (
    owner: string,
    nextOperation: PermissionOperation,
    trigger: HTMLElement,
    restore = true
  ): void => {
    if (ownerRef.current !== owner || operationRef.current !== nextOperation) return;
    operationRef.current = null;
    if (restore) focusRestoreRef.current = {
      trigger,
      ...(nextOperation.kind === "mode" ? { mode: nextOperation.mode } : {})
    };
    setOperation(null);
  };

  const setMode = async (
    mode: PermissionDefaultMode,
    trigger: HTMLElement,
    acknowledgeFullAccess = false
  ): Promise<void> => {
    const snapshot = currentRef.current;
    if (!snapshot || !props.api || operationRef.current || snapshot.defaultMode === mode) return;
    const nextOperation = { kind: "mode", mode } as const;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setNotice(null);
    let confirmationRequired = false;
    try {
      const result = await props.api.setDefaultMode({
        apiVersion: 1,
        requestId: createPermissionPolicyRequestId(),
        activeVaultId: snapshot.activeVaultId,
        expectedRevision: snapshot.revision,
        mode,
        ...(acknowledgeFullAccess ? {
          fullAccessAcknowledgement: {
            kind: "yolo_full_access" as const,
            explicitUserAction: true as const,
            hardBoundariesAcknowledged: true as const
          }
        } : {})
      });
      if (ownerRef.current !== snapshot.activeVaultId) return;
      if (result.status !== "failed") applyCurrent(result.summary);
      setNotice(result.status === "confirmation_required"
        ? "confirmation_required"
        : result.status === "stale"
          ? "stale"
          : result.status === "failed"
            ? "failed"
            : null);
      if (result.status === "committed" || result.status === "confirmation_required") {
        confirmationRequired = result.status === "confirmation_required";
        setFullAccessConfirming(false);
        setFullAccessAcknowledged(false);
      } else if (
        result.status === "stale" &&
        mode === "yolo_full_access" &&
        (result.summary.fullAccess.enabled === true ||
          (result.summary.fullAccess.enabled === false && !result.summary.fullAccess.canEnable))
      ) {
        setFullAccessConfirming(false);
        setFullAccessAcknowledged(false);
      }
    } catch {
      if (ownerRef.current === snapshot.activeVaultId) setNotice("failed");
    } finally {
      finish(snapshot.activeVaultId, nextOperation, trigger, !confirmationRequired);
    }
  };

  const revokeOne = async (
    snapshot: PermissionPolicySummary,
    grantId: string
  ): Promise<PermissionRevokeGrantResult | null> => {
    if (!props.api || ownerRef.current !== snapshot.activeVaultId) return null;
    try {
      return await props.api.revokeGrant({
        apiVersion: 1,
        requestId: createPermissionPolicyRequestId(),
        activeVaultId: snapshot.activeVaultId,
        expectedRevision: snapshot.revision,
        grantId
      });
    } catch {
      return null;
    }
  };

  const revokeGrant = async (grant: PermissionGrantSummary, trigger: HTMLElement): Promise<void> => {
    const snapshot = currentRef.current;
    if (!snapshot || operationRef.current || !grant.canRevoke) return;
    const nextOperation = { kind: "grant", grantId: grant.grantId } as const;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setNotice(null);
    try {
      const result = await revokeOne(snapshot, grant.grantId);
      if (ownerRef.current !== snapshot.activeVaultId) return;
      if (!result) setNotice("failed");
      else {
        if (result.status !== "failed") applyCurrent(result.summary);
        setNotice(result.status === "committed" ? null : result.status === "failed" ? "failed" : "stale");
      }
    } finally {
      finish(snapshot.activeVaultId, nextOperation, trigger);
    }
  };

  const revokeAll = async (trigger: HTMLElement): Promise<void> => {
    const snapshot = currentRef.current;
    if (!snapshot || operationRef.current || snapshot.grants.length === 0) return;
    const nextOperation = { kind: "all" } as const;
    const originalGrantIds = snapshot.grants.filter((grant) => grant.canRevoke).map((grant) => grant.grantId);
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setNotice(null);
    try {
      let authoritative = snapshot;
      for (const grantId of originalGrantIds) {
        if (!authoritative.grants.some((grant) => grant.grantId === grantId)) continue;
        const result = await revokeOne(authoritative, grantId);
        if (ownerRef.current !== snapshot.activeVaultId) return;
        if (!result) {
          setNotice("failed");
          return;
        }
        if (result.status === "failed") {
          setNotice("failed");
          return;
        }
        applyCurrent(result.summary);
        authoritative = result.summary;
        if (result.status !== "committed") {
          setNotice("stale");
          return;
        }
      }
    } finally {
      finish(snapshot.activeVaultId, nextOperation, trigger);
    }
  };

  const busy = operation !== null;
  const showRemembered = (current?.grants.length ?? 0) > 0;
  const fullAccessEnabled = current?.fullAccess.enabled === true;
  const fullAccessCanEnable = current?.fullAccess.enabled === false && current.fullAccess.canEnable;
  const fullAccessCanDisable = current?.fullAccess.enabled === true && current.fullAccess.canDisable;

  const cancelFullAccess = (): void => {
    if (busy) return;
    setFullAccessConfirming(false);
    setFullAccessAcknowledged(false);
    setNotice(null);
    const trigger = fullAccessTriggerRef.current;
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus();
    }, 0);
  };

  return (
    <section
      ref={panelRef}
      className="settings-page privacy-settings-page"
      aria-labelledby="settings-privacy-title"
    >
      <header className="settings-panel-header">
        <h1 id="settings-privacy-title">{props.t("privacy.title")}</h1>
        <p>{props.t("privacy.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="privacy-model-boundary-title">
        <h2 className="settings-section-title" id="privacy-model-boundary-title">
          {props.t("privacy.modelBoundary")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.ordinaryTitle")}</strong>
              <span>{props.t("privacy.ordinaryDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.connectedDefault")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.cloudPolicyTitle")}</strong>
              <span>{props.t("privacy.cloudPolicyDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.cloudPolicyStatus")}</span>
          </div>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="privacy-high-risk-title">
        <h2 className="settings-section-title" id="privacy-high-risk-title">
          {props.t("privacy.highRiskTitle")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.highRiskEffectsTitle")}</strong>
              <span>{props.t("privacy.highRiskEffectsDescription")}</span>
            </div>
            {!props.activeVaultId || !props.api ? (
              <span className="settings-status">{props.t("privacy.confirmEachEffect")}</span>
            ) : null}
          </div>
          {current ? (
            <>
              <fieldset
                className="permission-mode-fieldset"
                disabled={busy}
                aria-describedby="privacy-mode-description"
              >
                <legend>{props.t("privacy.permissionMode")}</legend>
                <p id="privacy-mode-description">{props.t("privacy.permissionModeDescription")}</p>
                <div className="permission-mode-options">
                  <label className="permission-mode-option">
                    <input
                      type="radio"
                      name="privacy-permission-mode"
                      checked={current.defaultMode === "ask_every_time"}
                      onChange={(event) => void setMode("ask_every_time", event.currentTarget)}
                    />
                    <span className="permission-mode-indicator" aria-hidden="true" />
                    <span className="permission-mode-copy">
                      <strong>{props.t("privacy.askEveryTime")}</strong>
                      <small>{props.t("privacy.askEveryTimeDescription")}</small>
                    </span>
                  </label>
                  <label className="permission-mode-option">
                    <input
                      type="radio"
                      name="privacy-permission-mode"
                      checked={current.defaultMode === "remember_scoped_grants"}
                      onChange={(event) => void setMode("remember_scoped_grants", event.currentTarget)}
                    />
                    <span className="permission-mode-indicator" aria-hidden="true" />
                    <span className="permission-mode-copy">
                      <strong>{props.t("privacy.rememberScoped")}</strong>
                      <small>{props.t("privacy.rememberScopedDescription")}</small>
                    </span>
                  </label>
                  <label className="permission-mode-option">
                    <input
                      type="radio"
                      name="privacy-permission-mode"
                      checked={current.defaultMode === "yolo_full_access"}
                      disabled={!fullAccessEnabled && !fullAccessCanEnable}
                      onChange={(event) => {
                        if (fullAccessEnabled) return;
                        fullAccessTriggerRef.current = event.currentTarget;
                        setNotice(null);
                        setFullAccessAcknowledged(false);
                        setFullAccessConfirming(true);
                      }}
                    />
                    <span className="permission-mode-indicator" aria-hidden="true" />
                    <span className="permission-mode-copy">
                      <strong>{props.t("privacy.fullAccessTitle")}</strong>
                      <small>{props.t("privacy.fullAccessModeDescription")}</small>
                    </span>
                  </label>
                </div>
              </fieldset>
              {fullAccessEnabled ? (
                <div className="settings-row" data-permission-mode="yolo_full_access">
                  <div className="settings-row-copy">
                    <strong>{props.t("privacy.fullAccessEnabled")}</strong>
                    <span>{props.t("privacy.fullAccessDescription")}</span>
                    <PermissionHardBoundaries
                      boundaries={current.fullAccess.hardBoundaries}
                      t={props.t}
                    />
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy || !fullAccessCanDisable}
                    onClick={(event) => void setMode("ask_every_time", event.currentTarget)}
                  >
                    {props.t("privacy.returnToAsk")}
                  </button>
                </div>
              ) : null}
              {fullAccessConfirming ? (
                <section
                  className="settings-row tall"
                  role="alertdialog"
                  aria-modal="false"
                  aria-labelledby="privacy-full-access-confirm-title"
                  aria-describedby="privacy-full-access-confirm-description"
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || event.nativeEvent.isComposing || busy) return;
                    event.preventDefault();
                    cancelFullAccess();
                  }}
                >
                  <div className="settings-row-copy">
                    <strong id="privacy-full-access-confirm-title">
                      {props.t("privacy.fullAccessConfirmTitle")}
                    </strong>
                    <span id="privacy-full-access-confirm-description">
                      {props.t("privacy.fullAccessDescription")}
                    </span>
                    <PermissionHardBoundaries
                      boundaries={current.fullAccess.hardBoundaries}
                      t={props.t}
                    />
                    <label className="permission-full-access-acknowledgement">
                      <input
                        ref={fullAccessAcknowledgeRef}
                        type="checkbox"
                        checked={fullAccessAcknowledged}
                        disabled={busy}
                        onChange={(event) => setFullAccessAcknowledged(event.currentTarget.checked)}
                      />
                      {props.t("privacy.fullAccessAcknowledge")}
                    </label>
                  </div>
                  <div className="permission-full-access-actions">
                    <button type="button" className="ghost" disabled={busy} onClick={cancelFullAccess}>
                      {props.t("privacy.fullAccessCancel")}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy || !fullAccessAcknowledged || fullAccessEnabled || !fullAccessCanEnable}
                      onClick={(event) => void setMode("yolo_full_access", event.currentTarget, true)}
                    >
                      {props.t("privacy.fullAccessEnable")}
                    </button>
                  </div>
                </section>
              ) : null}
              {showRemembered ? (
                <div className="settings-row permission-grants-row">
                  <div className="settings-row-copy">
                    <strong>{props.t("privacy.savedGrants")}</strong>
                    <span>{props.t("privacy.savedGrantsDescription")}</span>
                  </div>
                  <div className="permission-grants-control">
                    <ul className="permission-grant-list" aria-label={props.t("privacy.savedGrants")}>
                      {current.grants.map((grant) => (
                        <li key={grant.grantId}>
                          <span>{grant.actorLabel} · v{grant.actorVersion} · {grant.resourceLabel}</span>
                          <button
                            type="button"
                            className="ghost"
                            aria-label={`${props.t("privacy.revokeGrant")}: ${grant.actorLabel} · ${grant.resourceLabel}`}
                            disabled={busy || !grant.canRevoke}
                            onClick={(event) => void revokeGrant(grant, event.currentTarget)}
                          >
                            {props.t("privacy.revokeGrant")}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={(event) => void revokeAll(event.currentTarget)}
                    >
                      {props.t("privacy.revokeAllGrants")}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("privacy.noSavedAuthorityTitle")}</strong>
                <span>{props.t("privacy.noSavedAuthorityDescription")}</span>
              </div>
            </div>
          )}
        </div>
        {notice ? (
          <p className="settings-inline-status error" role="status" aria-live="polite">
            {props.t(notice === "stale"
              ? "privacy.permissionStale"
              : notice === "load_failed"
                ? "privacy.permissionLoadFailed"
                : notice === "confirmation_required"
                  ? "privacy.fullAccessAwaitingConfirmation"
                : "privacy.permissionFailed")}
          </p>
        ) : null}
      </section>

      <section className="settings-section" aria-labelledby="privacy-api-keys-title">
        <h2 className="settings-section-title" id="privacy-api-keys-title">
          {props.t("privacy.apiKeys")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("privacy.apiKeyStorageTitle")}</strong>
              <span>{props.t("privacy.apiKeyStorageDescription")}</span>
            </div>
            <span className="settings-status">{props.t("privacy.protected")}</span>
          </div>
        </div>
      </section>
    </section>
  );
}

function createPermissionPolicyRequestId(): string {
  return `permissionpolicyreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function PermissionHardBoundaries(props: {
  readonly boundaries: readonly PermissionYoloHardBoundary[];
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <div className="permission-hard-boundaries">
      <span>{props.t("privacy.fullAccessHardBoundaries")}</span>
      <ul>
        {props.boundaries.map((boundary) => (
          <li key={boundary}>{props.t(`privacy.fullAccessBoundary.${boundary}`)}</li>
        ))}
      </ul>
    </div>
  );
}
