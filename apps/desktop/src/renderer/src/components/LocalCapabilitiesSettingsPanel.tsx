import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PaddleOcrDisableRequest,
  PaddleOcrDisableResult,
  PaddleOcrEnableRequest,
  PaddleOcrEnableResult,
  PaddleOcrInstallRequest,
  PaddleOcrInstallResult,
  PaddleOcrLifecycleAction,
  PaddleOcrRemoveRequest,
  PaddleOcrRemoveResult,
  PaddleOcrSummary,
  PaddleOcrSummaryRequest,
  PaddleOcrTestRequest,
  PaddleOcrTestResult,
  SpeechAvailabilityResult,
  ToolchainHealth
} from "@pige/contracts";
import {
  LocalSemanticRetrievalSettingsPanel,
  type LocalSemanticRetrievalApi
} from "./LocalSemanticRetrievalSettingsPanel";

type Translate = (key: string) => string;
type PaddleOcrReadState = "loading" | "ready" | "failed";
type PaddleOcrNotice = "denied" | "stale" | "failed" | null;

export interface PaddleOcrApi {
  readonly paddleOcrSummary: (request: PaddleOcrSummaryRequest) => Promise<PaddleOcrSummary>;
  readonly installPaddleOcr: (request: PaddleOcrInstallRequest) => Promise<PaddleOcrInstallResult>;
  readonly enablePaddleOcr: (request: PaddleOcrEnableRequest) => Promise<PaddleOcrEnableResult>;
  readonly testPaddleOcr: (request: PaddleOcrTestRequest) => Promise<PaddleOcrTestResult>;
  readonly disablePaddleOcr: (request: PaddleOcrDisableRequest) => Promise<PaddleOcrDisableResult>;
  readonly removePaddleOcr: (request: PaddleOcrRemoveRequest) => Promise<PaddleOcrRemoveResult>;
}

export interface LocalCapabilitiesSettingsPanelProps {
  readonly paddleOcrApi: PaddleOcrApi;
  readonly semanticRetrievalApi: LocalSemanticRetrievalApi;
  readonly toolchainHealth: ToolchainHealth | null;
  readonly speechAvailability?: SpeechAvailabilityResult | null;
  readonly speechAvailabilityLoading?: boolean;
  readonly speechAvailabilityFailed?: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenSpeechSettings?: () => Promise<void>;
  readonly onDevelopment: () => void;
  readonly t: Translate;
}

const paddleOcrActions = ["install", "enable", "test", "disable", "remove"] as const;
const paddleOcrPollLimit = 60;

function createPaddleOcrRequestId(): string {
  return `paddleocr_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function formatDownloadSize(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: mebibytes >= 100 ? 0 : 1
  }).format(mebibytes)} MB`;
}

function actionsForSummary(summary: PaddleOcrSummary): readonly PaddleOcrLifecycleAction[] {
  if (summary.activeAction) return [];
  return paddleOcrActions.filter((action) => {
    if (action === "install") return summary.canInstall;
    if (action === "enable") return summary.canEnable;
    if (action === "test") return summary.canTest;
    if (action === "disable") return summary.canDisable;
    return summary.canRemove;
  });
}

function resultNotice(status: string): PaddleOcrNotice {
  if (status === "denied") return "denied";
  if (status === "stale" || status === "not_found") return "stale";
  if (status === "failed") return "failed";
  return null;
}

function resultSummary(
  result:
    | PaddleOcrInstallResult
    | PaddleOcrEnableResult
    | PaddleOcrTestResult
    | PaddleOcrDisableResult
    | PaddleOcrRemoveResult
): PaddleOcrSummary | null {
  return "summary" in result ? result.summary : null;
}

function PaddleOcrLifecyclePanel(props: {
  readonly api: PaddleOcrApi;
  readonly t: Translate;
}): React.JSX.Element {
  const [summary, setSummary] = useState<PaddleOcrSummary | null>(null);
  const [readState, setReadState] = useState<PaddleOcrReadState>("loading");
  const [pendingAction, setPendingAction] = useState<PaddleOcrLifecycleAction | null>(null);
  const [notice, setNotice] = useState<PaddleOcrNotice>(null);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const actionActiveRef = useRef(false);
  const pollStateRef = useRef<{ readonly jobId: string; attempts: number } | null>(null);

  const readSummary = useCallback(async (
    sequence: number,
    minimumRevision = 0
  ): Promise<PaddleOcrSummary | null> => {
    try {
      const next = await props.api.paddleOcrSummary({ apiVersion: 1 });
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return null;
      if (next.revision < minimumRevision) {
        setReadState("failed");
        return null;
      }
      setSummary(next);
      setReadState("ready");
      return next;
    } catch {
      if (mountedRef.current && sequence === requestSequenceRef.current) setReadState("failed");
      return null;
    }
  }, [props.api]);

  const refreshSummary = useCallback(async (): Promise<void> => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setReadState(summary ? "ready" : "loading");
    setNotice(null);
    await readSummary(sequence, summary?.revision ?? 0);
  }, [readSummary, summary]);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    void readSummary(sequence);
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      actionActiveRef.current = false;
      pollStateRef.current = null;
    };
  }, [readSummary]);

  useEffect(() => {
    if (!summary?.activeAction || !summary.activeJobId) {
      pollStateRef.current = null;
      return;
    }
    if (pollStateRef.current?.jobId !== summary.activeJobId) {
      pollStateRef.current = { jobId: summary.activeJobId, attempts: 0 };
    }
    const timer = window.setInterval(() => {
      const pollState = pollStateRef.current;
      if (!pollState || pollState.jobId !== summary.activeJobId) return;
      pollState.attempts += 1;
      if (pollState.attempts > paddleOcrPollLimit) {
        window.clearInterval(timer);
        setNotice("failed");
        return;
      }
      const sequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = sequence;
      void readSummary(sequence, summary.revision);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [readSummary, summary?.activeAction, summary?.activeJobId, summary?.revision]);

  const runAction = async (action: PaddleOcrLifecycleAction): Promise<void> => {
    const current = summary;
    if (!current || actionActiveRef.current || !actionsForSummary(current).includes(action)) return;
    actionActiveRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const requestId = createPaddleOcrRequestId();
    setPendingAction(action);
    setNotice(null);
    try {
      const request = {
        apiVersion: 1 as const,
        requestId,
        expectedRevision: current.revision
      };
      const result = action === "install"
        ? await props.api.installPaddleOcr(request)
        : action === "enable"
          ? await props.api.enablePaddleOcr(request)
          : action === "test"
            ? await props.api.testPaddleOcr(request)
            : action === "disable"
              ? await props.api.disablePaddleOcr(request)
              : await props.api.removePaddleOcr(request);
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
      if (result.requestId !== requestId) {
        setNotice("failed");
        return;
      }
      const next = resultSummary(result);
      if (next && next.revision < current.revision) {
        setNotice("failed");
        return;
      }
      if (next) {
        setSummary(next);
        setReadState("ready");
      }
      setNotice(result.status === "cancelled" ? null : resultNotice(result.status));
    } catch {
      if (mountedRef.current && sequence === requestSequenceRef.current) setNotice("failed");
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        actionActiveRef.current = false;
        setPendingAction(null);
      }
    }
  };

  const actions = readState === "ready" && summary ? actionsForSummary(summary) : [];
  const stateKey = readState === "loading" || !summary
    ? `capabilities.paddleOcr.state.${readState}`
    : summary.activeAction
      ? `capabilities.paddleOcr.progress.${summary.activeAction}`
      : `capabilities.paddleOcr.state.${summary.state}`;
  const warning = readState === "failed" || summary?.state === "needs_repair" ||
    summary?.state === "unsupported";

  return (
    <div className="settings-row tall" data-paddle-ocr-state={summary?.state ?? readState}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.paddleOcr.title")}</strong>
        <span>{props.t("capabilities.paddleOcr.description")}</span>
        {summary?.state === "not_installed" ? (
          <span>{props.t("capabilities.paddleOcr.downloadSize")} {formatDownloadSize(summary.downloadSizeBytes)}</span>
        ) : null}
        <span>{props.t("capabilities.paddleOcr.nativePreferred")}</span>
      </div>
      <div className="settings-row-control">
        <span
          className={`settings-status${warning ? " warning" : ""}`}
          data-paddle-ocr-status
          role={readState === "failed" ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {props.t(stateKey)}
        </span>
        {actions.map((action) => (
          <button
            className="settings-button"
            type="button"
            data-paddle-ocr-action={action}
            disabled={pendingAction !== null}
            key={action}
            onClick={() => void runAction(action)}
          >
            {props.t(pendingAction === action
              ? `capabilities.paddleOcr.progress.${action}`
              : `capabilities.paddleOcr.action.${action}`)}
          </button>
        ))}
        {readState === "failed" ? (
          <button className="settings-button" type="button" onClick={() => void refreshSummary()}>
            {props.t("capabilities.paddleOcr.retry")}
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="settings-inline-status error" role="alert" aria-live="polite">
          {props.t(`capabilities.paddleOcr.notice.${notice}`)}
        </p>
      ) : null}
    </div>
  );
}

export function LocalCapabilitiesSettingsPanel(
  props: LocalCapabilitiesSettingsPanelProps
): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const missingRequiredTools =
    props.toolchainHealth?.tools.filter((tool) => tool.required && tool.status === "missing") ?? [];
  const toolchainState = props.toolchainHealth?.status ?? "checking";
  const speechCapabilityState = props.speechAvailabilityLoading
    ? "checking"
    : props.speechAvailabilityFailed || props.speechAvailability?.status === "failed"
      ? "failed"
      : props.speechAvailability?.status === "supported"
        ? props.speechAvailability.permission === "denied" || props.speechAvailability.permission === "restricted"
          ? "permission_needed"
          : "available"
        : props.speechAvailability?.status === "unsupported"
          ? props.speechAvailability.reason === "assets_unavailable"
            ? "asset_needed"
            : "unavailable"
          : "checking";
  const speechSettingsAvailable = props.speechAvailability?.status === "supported" &&
    props.speechAvailability.canOpenSystemSettings &&
    (props.speechAvailability.permission === "denied" || props.speechAvailability.permission === "restricted");

  const refresh = async (): Promise<void> => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await props.onRefresh();
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section className="settings-page capabilities-settings-page" aria-labelledby="settings-capabilities-title">
      <header className="settings-panel-header">
        <h1 id="settings-capabilities-title">{props.t("capabilities.title")}</h1>
        <p>{props.t("capabilities.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="capabilities-toolchain-title">
        <h2 className="settings-section-title" id="capabilities-toolchain-title">
          {props.t("capabilities.coreTools")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.toolchainTitle")}</strong>
              <span>{props.t("capabilities.toolchainDescription")}</span>
            </div>
            <span className={`settings-status ${toolchainState === "needs_repair" ? "warning" : ""}`}>
              {props.t(`capabilities.toolchain.${toolchainState}`)}
            </span>
          </div>
          <div className="settings-row tall">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.detectedTools")}</strong>
              {props.toolchainHealth ? (
                <ul className="capability-tool-list" aria-label={props.t("capabilities.detectedTools")}>
                  {props.toolchainHealth.tools.map((tool) => {
                    const statusKey = tool.status === "ready"
                      ? "capabilities.tool.ready"
                      : tool.required
                        ? "capabilities.tool.missing"
                        : "capabilities.tool.optional_missing";
                    const statusLabel = props.t(statusKey);
                    return (
                      <li
                        key={tool.id}
                        aria-label={`${tool.name}: ${statusLabel}`}
                        data-tool-required={tool.required ? "true" : "false"}
                        data-tool-status={tool.status}
                      >
                        <span>{tool.name}</span>
                        <small className={tool.status === "ready" ? "ready" : tool.required ? "missing" : "optional-missing"}>
                          {statusLabel}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <span>{props.t("capabilities.checkingDescription")}</span>
              )}
            </div>
            <button
              className="settings-button"
              type="button"
              disabled={refreshing}
              aria-describedby="capabilities-refresh-status"
              onClick={() => void refresh()}
            >
              {props.t(refreshing ? "capabilities.checking" : "capabilities.checkAgain")}
            </button>
          </div>
          {missingRequiredTools.length > 0 ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <strong>{props.t("capabilities.repairTitle")}</strong>
                <span>{props.t("capabilities.repairDescription")}</span>
              </div>
              <button className="settings-button" type="button" onClick={props.onDevelopment}>
                {props.t("capabilities.repair")}
              </button>
            </div>
          ) : null}
        </div>
        <p
          className={refreshFailed ? "settings-inline-status error" : "settings-inline-status"}
          id="capabilities-refresh-status"
          role={refreshFailed ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
        >
          {refreshFailed ? props.t("capabilities.refreshFailed") : ""}
        </p>
      </section>

      <LocalSemanticRetrievalSettingsPanel api={props.semanticRetrievalApi} t={props.t} />

      <section className="settings-section" aria-labelledby="capabilities-input-title">
        <h2 className="settings-section-title" id="capabilities-input-title">
          {props.t("capabilities.ocrAndVoice")}
        </h2>
        <div className="settings-card">
          <PaddleOcrLifecyclePanel api={props.paddleOcrApi} t={props.t} />
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.imageOcrTitle")}</strong>
              <span>{props.t("capabilities.imageOcrDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              data-capability-control="image-ocr"
              aria-label={`${props.t("capabilities.imageOcrTitle")}: ${props.t("settings.status.development")}`}
              aria-describedby="capabilities-partial-note"
              onClick={props.onDevelopment}
            >
              {props.t("settings.status.development")}
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.voiceTitle")}</strong>
              <span>{props.t("capabilities.voiceDescription")}</span>
            </div>
            <div className="settings-row-control">
              <span
                className={`settings-status${speechCapabilityState === "available" ? "" : " warning"}`}
                data-capability-status="voice-input"
                role={speechCapabilityState === "failed" ? "alert" : "status"}
                aria-live="polite"
              >
                {props.t(`capabilities.voice.${speechCapabilityState}`)}
              </span>
              {speechSettingsAvailable ? (
                <button
                  className="settings-button"
                  type="button"
                  data-capability-control="voice-open-settings"
                  onClick={() => void props.onOpenSpeechSettings?.()}
                >
                  {props.t("capabilities.voice.openSettings")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <p className="settings-note" id="capabilities-partial-note">{props.t("capabilities.partialNote")}</p>
    </section>
  );
}
