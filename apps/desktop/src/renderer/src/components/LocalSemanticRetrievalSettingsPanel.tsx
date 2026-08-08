import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LocalSemanticRetrievalDisableRequest,
  LocalSemanticRetrievalDisableResult,
  LocalSemanticRetrievalEnableRequest,
  LocalSemanticRetrievalEnableResult,
  LocalSemanticRetrievalInstallRequest,
  LocalSemanticRetrievalInstallResult,
  LocalSemanticRetrievalRemoveRequest,
  LocalSemanticRetrievalRemoveResult,
  LocalSemanticRetrievalStatus,
  LocalSemanticRetrievalStatusRequest
} from "@pige/contracts";

type Translate = (key: string) => string;
type SemanticAssetAction = "install" | "enable" | "disable" | "remove";
type SemanticAssetNotice = "stale" | "not_found" | "failed";

export interface LocalSemanticRetrievalApi {
  readonly localSemanticStatus: (
    request: LocalSemanticRetrievalStatusRequest
  ) => Promise<LocalSemanticRetrievalStatus>;
  readonly installLocalSemanticAsset: (
    request: LocalSemanticRetrievalInstallRequest
  ) => Promise<LocalSemanticRetrievalInstallResult>;
  readonly enableLocalSemanticAsset: (
    request: LocalSemanticRetrievalEnableRequest
  ) => Promise<LocalSemanticRetrievalEnableResult>;
  readonly disableLocalSemanticAsset: (
    request: LocalSemanticRetrievalDisableRequest
  ) => Promise<LocalSemanticRetrievalDisableResult>;
  readonly removeLocalSemanticAsset: (
    request: LocalSemanticRetrievalRemoveRequest
  ) => Promise<LocalSemanticRetrievalRemoveResult>;
}

export interface LocalSemanticRetrievalSettingsPanelProps {
  readonly api: LocalSemanticRetrievalApi;
  readonly t: Translate;
}

function createRequestId(): string {
  return `ragasset_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function actionsForStatus(status: LocalSemanticRetrievalStatus): readonly SemanticAssetAction[] {
  switch (status.assetState) {
    case "not_installed":
      return ["install"];
    case "ready":
      return ["disable", "remove"];
    case "disabled":
      return ["enable", "remove"];
    case "needs_repair":
      return ["install", "remove"];
    case "installing":
    case "verifying":
      return [];
  }
}

function actionLabelKey(action: SemanticAssetAction, pending: boolean): string {
  if (!pending) return `capabilities.semanticAsset.action.${action}`;
  switch (action) {
    case "install": return "capabilities.semanticAsset.action.installing";
    case "enable": return "capabilities.semanticAsset.action.enabling";
    case "disable": return "capabilities.semanticAsset.action.disabling";
    case "remove": return "capabilities.semanticAsset.action.removing";
  }
}

export function LocalSemanticRetrievalSettingsPanel(
  props: LocalSemanticRetrievalSettingsPanelProps
): React.JSX.Element {
  const [status, setStatus] = useState<LocalSemanticRetrievalStatus | null>(null);
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [pendingAction, setPendingAction] = useState<SemanticAssetAction | null>(null);
  const [actionNotice, setActionNotice] = useState<SemanticAssetNotice | null>(null);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const actionActiveRef = useRef(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const actionTriggerRefs = useRef(new Map<SemanticAssetAction, HTMLButtonElement>());
  const pendingFocusActionRef = useRef<SemanticAssetAction | null>(null);

  useEffect(() => {
    if (pendingAction !== null || pendingFocusActionRef.current === null) return;
    const action = pendingFocusActionRef.current;
    pendingFocusActionRef.current = null;
    const firstAvailableAction = actionTriggerRefs.current.values().next().value;
    (actionTriggerRefs.current.get(action) ?? firstAvailableAction ?? rowRef.current)?.focus({ preventScroll: true });
  }, [actionNotice, pendingAction, readState, status]);

  const readStatus = useCallback(async (
    sequence: number,
    minimumRevision = 0
  ): Promise<LocalSemanticRetrievalStatus | null> => {
    try {
      const next = await props.api.localSemanticStatus({ apiVersion: 1 });
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return null;
      if (next.revision < minimumRevision) return null;
      setStatus(next);
      setReadState("ready");
      return next;
    } catch {
      if (mountedRef.current && sequence === requestSequenceRef.current) setReadState("failed");
      return null;
    }
  }, [props.api]);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setActionNotice(null);
    setReadState(status ? "ready" : "loading");
    await readStatus(sequence, status?.revision ?? 0);
  }, [readStatus, status]);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    void readStatus(sequence);
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      actionActiveRef.current = false;
    };
  }, [readStatus]);

  useEffect(() => {
    if (!status || (status.assetState !== "installing" && status.assetState !== "verifying")) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, status]);

  const runAction = async (action: SemanticAssetAction): Promise<void> => {
    const current = status;
    if (!current || actionActiveRef.current || !actionsForStatus(current).includes(action)) return;
    actionActiveRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const requestId = createRequestId();
    pendingFocusActionRef.current = action;
    setPendingAction(action);
    setActionNotice(null);
    try {
      const request = {
        apiVersion: 1 as const,
        requestId,
        expectedRevision: current.revision
      };
      const result = action === "install"
        ? await props.api.installLocalSemanticAsset(request)
        : action === "enable"
          ? await props.api.enableLocalSemanticAsset(request)
          : action === "disable"
            ? await props.api.disableLocalSemanticAsset(request)
            : await props.api.removeLocalSemanticAsset(request);
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
      if (result.requestId !== requestId || result.status === "failed") {
        setActionNotice("failed");
        return;
      }
      if (result.status === "stale") setActionNotice("stale");
      else if (result.status === "not_found") setActionNotice("not_found");
      const next = await readStatus(sequence, Math.max(current.revision, result.revision));
      if (!next) setActionNotice("failed");
    } catch {
      if (mountedRef.current && sequence === requestSequenceRef.current) setActionNotice("failed");
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        actionActiveRef.current = false;
        setPendingAction(null);
      }
    }
  };

  const actions = readState === "ready" && status ? actionsForStatus(status) : [];
  const statusKey = readState === "loading"
    ? "capabilities.semanticAsset.state.checking"
    : readState === "failed"
      ? "capabilities.semanticAsset.state.failed"
      : `capabilities.semanticAsset.state.${status?.assetState ?? "failed"}`;
  const actionNoticeKey = actionNotice === "stale"
    ? "capabilities.semanticAsset.notice.stale"
    : actionNotice === "not_found"
      ? "capabilities.semanticAsset.notice.notFound"
      : "capabilities.semanticAsset.actionFailed";

  return (
    <section className="settings-section" aria-labelledby="capabilities-retrieval-title">
      <h2 className="settings-section-title" id="capabilities-retrieval-title">
        {props.t("capabilities.localRetrieval")}
      </h2>
      <div className="settings-card">
        <div ref={rowRef} className="settings-row tall" data-semantic-asset-state={status?.assetState ?? readState} tabIndex={-1}>
          <div className="settings-row-copy">
            <strong>{props.t("capabilities.semanticAsset.title")}</strong>
            <span>{props.t("capabilities.semanticAsset.description")}</span>
          </div>
          <div className="settings-row-control">
            <span
              className={`settings-status${status?.assetState === "needs_repair" || readState === "failed" ? " warning" : ""}`}
              role={readState === "failed" ? "alert" : "status"}
              aria-live="polite"
              aria-atomic="true"
            >
              {props.t(statusKey)}
            </span>
            {actions.map((action) => (
              <button
                className="settings-button"
                type="button"
                data-semantic-asset-action={action}
                ref={(node) => {
                  if (node) actionTriggerRefs.current.set(action, node);
                  else actionTriggerRefs.current.delete(action);
                }}
                disabled={pendingAction !== null}
                key={action}
                onClick={() => void runAction(action)}
              >
                {props.t(actionLabelKey(action, pendingAction === action))}
              </button>
            ))}
            {readState === "failed" ? (
              <button className="settings-button" type="button" onClick={() => void refresh()}>
                {props.t("capabilities.semanticAsset.retry")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {actionNotice ? (
        <p className="settings-inline-status error" role="alert" aria-live="polite">
          {props.t(actionNoticeKey)}
        </p>
      ) : null}
    </section>
  );
}
