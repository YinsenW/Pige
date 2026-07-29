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
  PermissionSetDefaultModeResult
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
  const [notice, setNotice] = useState<"load_failed" | "stale" | "failed" | null>(null);
  const [operation, setOperation] = useState<PermissionOperation | null>(null);
  const currentRef = useRef(current);
  const ownerRef = useRef(props.activeVaultId);
  const operationRef = useRef<PermissionOperation | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

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
    setCurrent(null);
    setOperation(null);
    setNotice(null);
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

  const finish = (
    owner: string,
    nextOperation: PermissionOperation,
    trigger: HTMLElement
  ): void => {
    if (ownerRef.current !== owner || operationRef.current !== nextOperation) return;
    operationRef.current = null;
    setOperation(null);
    const restoreFocus = (): void => {
      if (trigger.isConnected) {
        trigger.focus();
        return;
      }
      const fallback = panelRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), input[name="privacy-permission-mode"]:checked'
      );
      fallback?.focus();
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreFocus);
    else window.setTimeout(restoreFocus, 0);
  };

  const setMode = async (mode: PermissionDefaultMode, trigger: HTMLElement): Promise<void> => {
    const snapshot = currentRef.current;
    if (!snapshot || !props.api || operationRef.current || snapshot.defaultMode === mode) return;
    const nextOperation = { kind: "mode", mode } as const;
    operationRef.current = nextOperation;
    setOperation(nextOperation);
    setNotice(null);
    try {
      const result = await props.api.setDefaultMode({
        apiVersion: 1,
        requestId: createPermissionPolicyRequestId(),
        activeVaultId: snapshot.activeVaultId,
        expectedRevision: snapshot.revision,
        mode
      });
      if (ownerRef.current !== snapshot.activeVaultId) return;
      if (result.status === "committed" || result.status === "stale") applyCurrent(result.summary);
      setNotice(result.status === "stale" ? "stale" : result.status === "failed" ? "failed" : null);
    } catch {
      if (ownerRef.current === snapshot.activeVaultId) setNotice("failed");
    } finally {
      finish(snapshot.activeVaultId, nextOperation, trigger);
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
  const showRemembered = current?.defaultMode === "remember_scoped_grants" || (current?.grants.length ?? 0) > 0;

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
            <span className="settings-status">
              {props.t(current?.defaultMode === "remember_scoped_grants"
                ? "privacy.rememberScopedStatus"
                : "privacy.confirmEachEffect")}
            </span>
          </div>
          {current ? (
            <>
              <fieldset className="settings-row" disabled={busy} aria-describedby="privacy-mode-description">
                <div className="settings-row-copy">
                  <legend><strong>{props.t("privacy.permissionMode")}</strong></legend>
                  <span id="privacy-mode-description">{props.t("privacy.permissionModeDescription")}</span>
                </div>
                <div>
                  <label>
                    <input
                      type="radio"
                      name="privacy-permission-mode"
                      checked={current.defaultMode === "ask_every_time"}
                      onChange={(event) => void setMode("ask_every_time", event.currentTarget)}
                    />
                    {props.t("privacy.askEveryTime")}
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="privacy-permission-mode"
                      checked={current.defaultMode === "remember_scoped_grants"}
                      onChange={(event) => void setMode("remember_scoped_grants", event.currentTarget)}
                    />
                    {props.t("privacy.rememberScoped")}
                  </label>
                </div>
              </fieldset>
              {showRemembered ? (
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <strong>{props.t("privacy.savedGrants")}</strong>
                    <span>{props.t("privacy.savedGrantsDescription")}</span>
                  </div>
                  <div>
                    {current.grants.length === 0 ? (
                      <span className="settings-status">{props.t("privacy.noSavedGrants")}</span>
                    ) : (
                      <ul aria-label={props.t("privacy.savedGrants")}>
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
                    )}
                    {current.grants.length > 0 ? (
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={(event) => void revokeAll(event.currentTarget)}
                      >
                        {props.t("privacy.revokeAllGrants")}
                      </button>
                    ) : null}
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
