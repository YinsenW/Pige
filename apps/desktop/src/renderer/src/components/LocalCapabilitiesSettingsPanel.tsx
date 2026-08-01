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
  OcrLanguagePreference,
  OcrLanguagePreferenceRequest,
  OcrLanguagePreferenceResult,
  SetOcrLanguagePreferenceRequest,
  SetOcrLanguagePreferenceResult,
  DictationLanguagePreference,
  DictationLanguagePreferenceRequest,
  DictationLanguagePreferenceResult,
  SetDictationLanguagePreferenceRequest,
  SetDictationLanguagePreferenceResult,
  SpeechAssetInstallEvent,
  SpeechAssetInstallRequest,
  SpeechAssetInstallResult,
  SpeechAvailabilityResult,
  ToolchainHealth,
  ToolchainRepairResult
} from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import {
  LocalSemanticRetrievalSettingsPanel,
  type LocalSemanticRetrievalApi
} from "./LocalSemanticRetrievalSettingsPanel";
import { LocalRerankerSettingsPanel, type LocalRerankerApi } from "./LocalRerankerSettingsPanel";
import {
  OcrEnginePreferenceControl,
  type OcrEnginePreferenceApi
} from "./OcrEnginePreferenceControl";
import { OcrImageTestControl, type OcrImageTestApi } from "./OcrImageTestControl";
import {
  OcrSummaryPreferenceControl,
  type OcrSummaryPreferenceApi
} from "./OcrSummaryPreferenceControl";
export type { OcrEnginePreferenceApi } from "./OcrEnginePreferenceControl";

type Translate = (key: string) => string;
type PaddleOcrReadState = "loading" | "ready" | "failed";
type PaddleOcrNotice = "denied" | "stale" | "failed" | null;
type OcrLanguagePreferenceValue = "automatic" | Locale;
type OcrLanguagePreferenceNotice = "stale" | "failed" | null;
type DictationLanguagePreferenceValue = "automatic" | Locale;
type DictationLanguagePreferenceNotice = "stale" | "failed" | null;
type ToolchainReinstallNotice = ToolchainRepairResult["status"] | null;

export interface OcrLanguagePreferenceApi {
  readonly ocrLanguagePreference: (
    request: OcrLanguagePreferenceRequest
  ) => Promise<OcrLanguagePreferenceResult>;
  readonly setOcrLanguagePreference: (
    request: SetOcrLanguagePreferenceRequest
  ) => Promise<SetOcrLanguagePreferenceResult>;
}

export interface DictationLanguagePreferenceApi {
  readonly dictationLanguagePreference: (
    request: DictationLanguagePreferenceRequest
  ) => Promise<DictationLanguagePreferenceResult>;
  readonly setDictationLanguagePreference: (
    request: SetDictationLanguagePreferenceRequest
  ) => Promise<SetDictationLanguagePreferenceResult>;
}

export interface PaddleOcrApi {
  readonly paddleOcrSummary: (request: PaddleOcrSummaryRequest) => Promise<PaddleOcrSummary>;
  readonly installPaddleOcr: (request: PaddleOcrInstallRequest) => Promise<PaddleOcrInstallResult>;
  readonly enablePaddleOcr: (request: PaddleOcrEnableRequest) => Promise<PaddleOcrEnableResult>;
  readonly testPaddleOcr: (request: PaddleOcrTestRequest) => Promise<PaddleOcrTestResult>;
  readonly disablePaddleOcr: (request: PaddleOcrDisableRequest) => Promise<PaddleOcrDisableResult>;
  readonly removePaddleOcr: (request: PaddleOcrRemoveRequest) => Promise<PaddleOcrRemoveResult>;
}

export interface SpeechAssetApi {
  readonly installLanguageAsset: (request: SpeechAssetInstallRequest) => Promise<SpeechAssetInstallResult>;
  readonly onAssetInstallEvent: (listener: (event: SpeechAssetInstallEvent) => void) => () => void;
}

export interface LocalCapabilitiesSettingsPanelProps {
  readonly dictationLanguagePreferenceApi?: DictationLanguagePreferenceApi;
  readonly onDictationLanguagePreferenceChanged?: (
    preference: DictationLanguagePreference
  ) => void;
  readonly ocrLanguagePreferenceApi?: OcrLanguagePreferenceApi;
  readonly ocrEnginePreferenceApi?: OcrEnginePreferenceApi;
  readonly ocrImageTestApi?: OcrImageTestApi;
  readonly ocrSummaryPreferenceApi?: OcrSummaryPreferenceApi;
  readonly paddleOcrApi: PaddleOcrApi;
  readonly semanticRetrievalApi: LocalSemanticRetrievalApi;
  readonly rerankerApi: LocalRerankerApi;
  readonly toolchainHealth: ToolchainHealth | null;
  readonly speechAvailability?: SpeechAvailabilityResult | null;
  readonly speechAvailabilityLoading?: boolean;
  readonly speechAvailabilityFailed?: boolean;
  readonly speechAssetApi?: SpeechAssetApi;
  readonly speechLanguageTag?: Locale;
  readonly onRefreshSpeechAvailability?: () => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onOpenSpeechSettings?: () => Promise<void>;
  readonly onOpenToolchainReinstall?: () => Promise<ToolchainRepairResult["status"]>;
  readonly onDevelopment: () => void;
  readonly t: Translate;
}

const paddleOcrActions = ["install", "enable", "test", "disable", "remove"] as const;
const paddleOcrPollLimit = 60;
const ocrLanguagePreferences = ["automatic", "zh-Hans", "en", "ja", "ko", "fr", "de"] as const;
const ocrLanguageLabels: Record<Locale, string> = {
  "zh-Hans": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch"
};

function createPaddleOcrRequestId(): string {
  return `paddleocr_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createOcrLanguagePreferenceRequestId(): string {
  return `ocrlangreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createDictationLanguagePreferenceRequestId(): string {
  return `dictlangreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function ocrLanguagePreferenceValue(preference: OcrLanguagePreference): OcrLanguagePreferenceValue {
  return preference.mode === "automatic" ? "automatic" : preference.language;
}

function ocrLanguagePreference(value: OcrLanguagePreferenceValue): OcrLanguagePreference {
  return value === "automatic" ? { mode: "automatic" } : { mode: "preferred", language: value };
}

function dictationLanguagePreferenceValue(
  preference: DictationLanguagePreference
): DictationLanguagePreferenceValue {
  return preference.mode === "automatic" ? "automatic" : preference.language;
}

function dictationLanguagePreference(
  value: DictationLanguagePreferenceValue
): DictationLanguagePreference {
  return value === "automatic" ? { mode: "automatic" } : { mode: "preferred", language: value };
}

function formatDownloadSize(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: mebibytes >= 100 ? 0 : 1
  }).format(mebibytes)} MB`;
}

function OcrLanguagePreferenceControl(props: {
  readonly api: OcrLanguagePreferenceApi;
  readonly t: Translate;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Extract<OcrLanguagePreferenceResult, { status: "ready" }>["summary"] | null>(null);
  const [draft, setDraft] = useState<OcrLanguagePreferenceValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<OcrLanguagePreferenceNotice>(null);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const updateActiveRef = useRef(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setLoading(true);
    const requestId = createOcrLanguagePreferenceRequestId();
    void props.api.ocrLanguagePreference({ apiVersion: 1, requestId }).then((result) => {
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
      if (result.requestId !== requestId || result.status !== "ready") {
        setNotice("failed");
        setLoading(false);
        return;
      }
      setSnapshot(result.summary);
      setDraft(ocrLanguagePreferenceValue(result.summary.preference));
      setNotice(null);
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
      setNotice("failed");
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      updateActiveRef.current = false;
    };
  }, [props.api]);

  const updatePreference = async (preference: OcrLanguagePreferenceValue): Promise<void> => {
    const current = snapshot;
    if (!current || updateActiveRef.current || pending) return;
    updateActiveRef.current = true;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setDraft(preference);
    setPending(true);
    setNotice(null);
    try {
      const requestId = createOcrLanguagePreferenceRequestId();
      const result = await props.api.setOcrLanguagePreference({
        apiVersion: 1,
        requestId,
        preference: ocrLanguagePreference(preference),
        expectedRevision: current.revision
      });
      if (!mountedRef.current || sequence !== requestSequenceRef.current) return;
      if (result.requestId !== requestId) {
        setNotice("failed");
        return;
      }
      if ("summary" in result && result.summary.revision >= current.revision) {
        setSnapshot(result.summary);
        if (result.status === "committed") setDraft(ocrLanguagePreferenceValue(result.summary.preference));
      }
      setNotice(result.status === "committed" ? null : result.status);
    } catch {
      if (mountedRef.current && sequence === requestSequenceRef.current) setNotice("failed");
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        updateActiveRef.current = false;
        setPending(false);
        window.setTimeout(() => selectRef.current?.focus(), 0);
      }
    }
  };

  return (
    <div className="settings-row tall" data-ocr-language-preference={draft ?? "loading"}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.ocrLanguage.title")}</strong>
        <span id="capabilities-ocr-language-description">{props.t("capabilities.ocrLanguage.description")}</span>
      </div>
      <div className="settings-row-control">
        <select
          ref={selectRef}
          className="settings-select"
          aria-label={props.t("capabilities.ocrLanguage.title")}
          aria-describedby={`capabilities-ocr-language-description${notice ? " capabilities-ocr-language-notice" : ""}`}
          disabled={loading || pending || !snapshot}
          value={draft ?? "automatic"}
          onChange={(event) => void updatePreference(event.target.value as OcrLanguagePreferenceValue)}
        >
          {ocrLanguagePreferences.map((preference) => (
            <option key={preference} value={preference}>
              {preference === "automatic"
                ? props.t("capabilities.ocrLanguage.automatic")
                : ocrLanguageLabels[preference]}
            </option>
          ))}
        </select>
      </div>
      {notice ? (
        <p
          className="settings-inline-status error"
          id="capabilities-ocr-language-notice"
          role={notice === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {props.t(`capabilities.ocrLanguage.notice.${notice}`)}
        </p>
      ) : null}
    </div>
  );
}

function DictationLanguagePreferenceControl(props: {
  readonly api: DictationLanguagePreferenceApi;
  readonly onPreferenceChanged?: (preference: DictationLanguagePreference) => void;
  readonly t: Translate;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Extract<
    DictationLanguagePreferenceResult,
    { status: "ready" }
  >["summary"] | null>(null);
  const [draft, setDraft] = useState<DictationLanguagePreferenceValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<DictationLanguagePreferenceNotice>(null);
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const requestId = createDictationLanguagePreferenceRequestId();
    void props.api.dictationLanguagePreference({ apiVersion: 1, requestId }).then((result) => {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId || result.status !== "ready") {
        setNotice("failed");
        setLoading(false);
        return;
      }
      setSnapshot(result.summary);
      setDraft(dictationLanguagePreferenceValue(result.summary.preference));
      props.onPreferenceChanged?.(result.summary.preference);
      setNotice(null);
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      setNotice("failed");
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
    };
  }, [props.api, props.onPreferenceChanged]);

  const updatePreference = async (value: DictationLanguagePreferenceValue): Promise<void> => {
    const current = snapshot;
    if (!current || pending) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setDraft(value);
    setPending(true);
    setNotice(null);
    try {
      const requestId = createDictationLanguagePreferenceRequestId();
      const result = await props.api.setDictationLanguagePreference({
        apiVersion: 1,
        requestId,
        expectedRevision: current.revision,
        preference: dictationLanguagePreference(value)
      });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (result.requestId !== requestId) {
        setNotice("failed");
        return;
      }
      if ("summary" in result) {
        setSnapshot(result.summary);
        props.onPreferenceChanged?.(result.summary.preference);
        if (result.status === "committed") {
          setDraft(dictationLanguagePreferenceValue(result.summary.preference));
        }
      }
      setNotice(result.status === "committed" ? null : result.status);
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) setNotice("failed");
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setPending(false);
        window.setTimeout(() => selectRef.current?.focus(), 0);
      }
    }
  };

  return (
    <div className="settings-row tall" data-dictation-language-preference={draft ?? "loading"}>
      <div className="settings-row-copy">
        <strong>{props.t("capabilities.dictationLanguage.title")}</strong>
        <span id="capabilities-dictation-language-description">
          {props.t("capabilities.dictationLanguage.description")}
        </span>
      </div>
      <div className="settings-row-control">
        <select
          ref={selectRef}
          className="settings-select"
          aria-label={props.t("capabilities.dictationLanguage.title")}
          aria-describedby={`capabilities-dictation-language-description${notice
            ? " capabilities-dictation-language-notice"
            : ""}`}
          disabled={loading || pending || !snapshot}
          value={draft ?? "automatic"}
          onChange={(event) => void updatePreference(
            event.target.value as DictationLanguagePreferenceValue
          )}
        >
          {ocrLanguagePreferences.map((preference) => (
            <option key={preference} value={preference}>
              {preference === "automatic"
                ? props.t("capabilities.dictationLanguage.automatic")
                : ocrLanguageLabels[preference]}
            </option>
          ))}
        </select>
      </div>
      {notice ? (
        <p
          className="settings-inline-status error"
          id="capabilities-dictation-language-notice"
          role={notice === "failed" ? "alert" : "status"}
          aria-live="polite"
        >
          {props.t(`capabilities.dictationLanguage.notice.${notice}`)}
        </p>
      ) : null}
    </div>
  );
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
  const ocrEnginePreferenceApi = props.ocrEnginePreferenceApi;
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [toolchainReinstallPending, setToolchainReinstallPending] = useState(false);
  const [toolchainReinstallNotice, setToolchainReinstallNotice] = useState<ToolchainReinstallNotice>(null);
  const [speechAssetState, setSpeechAssetState] = useState<"idle" | "installing" | "failed">("idle");
  const [speechAssetProgress, setSpeechAssetProgress] = useState<number | null>(null);
  const speechAssetRequestRef = useRef<string | null>(null);
  const speechAssetInstallationRef = useRef<string | null>(null);
  const speechAssetSequenceRef = useRef(0);
  const speechAssetBufferedEventsRef = useRef<SpeechAssetInstallEvent[]>([]);
  const speechAssetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const speechStatusRef = useRef<HTMLSpanElement | null>(null);
  const toolchainReinstallActiveRef = useRef(false);
  const toolchainReinstallTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toolchainRefreshTriggerRef = useRef<HTMLButtonElement | null>(null);
  const currentSpeechLanguageRef = useRef(props.speechLanguageTag);
  currentSpeechLanguageRef.current = props.speechLanguageTag;
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
  const speechAssetInstallAvailable = speechCapabilityState === "asset_needed" &&
    Boolean(props.speechAssetApi && props.speechLanguageTag && props.onRefreshSpeechAvailability);

  const restoreSpeechAssetFocus = (): void => {
    window.setTimeout(() => (speechAssetTriggerRef.current ?? speechStatusRef.current)?.focus(), 0);
  };
  const applySpeechAssetEvent = (event: SpeechAssetInstallEvent): void => {
    if (
      event.installationId !== speechAssetInstallationRef.current ||
      event.sequence <= speechAssetSequenceRef.current
    ) return;
    speechAssetSequenceRef.current = event.sequence;
    if (event.kind === "progress") {
      setSpeechAssetProgress(Math.round(event.completedFraction * 100));
      return;
    }
    speechAssetInstallationRef.current = null;
    if (event.kind === "failed" || event.languageTag !== currentSpeechLanguageRef.current) {
      setSpeechAssetState("failed");
      setSpeechAssetProgress(null);
      restoreSpeechAssetFocus();
      return;
    }
    setSpeechAssetProgress(100);
    void props.onRefreshSpeechAvailability?.().then(() => {
      setSpeechAssetState("idle");
      restoreSpeechAssetFocus();
    }).catch(() => {
      setSpeechAssetState("failed");
      setSpeechAssetProgress(null);
      restoreSpeechAssetFocus();
    });
  };
  const installSpeechAsset = async (): Promise<void> => {
    if (!speechAssetInstallAvailable || speechAssetRequestRef.current || speechAssetInstallationRef.current) return;
    const requestId = `speechasset_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
    const languageTag = props.speechLanguageTag!;
    speechAssetRequestRef.current = requestId;
    speechAssetSequenceRef.current = 0;
    speechAssetBufferedEventsRef.current = [];
    setSpeechAssetState("installing");
    setSpeechAssetProgress(null);
    try {
      const result = await props.speechAssetApi!.installLanguageAsset({ requestId, languageTag });
      if (speechAssetRequestRef.current !== requestId) return;
      speechAssetRequestRef.current = null;
      if (currentSpeechLanguageRef.current !== languageTag) {
        setSpeechAssetState("idle");
        setSpeechAssetProgress(null);
        return;
      }
      if (
        result.requestId !== requestId ||
        result.status !== "started" ||
        result.languageTag !== languageTag
      ) {
        setSpeechAssetState("failed");
        restoreSpeechAssetFocus();
        return;
      }
      speechAssetInstallationRef.current = result.installationId;
      for (const event of speechAssetBufferedEventsRef.current) applySpeechAssetEvent(event);
      speechAssetBufferedEventsRef.current = [];
    } catch {
      if (speechAssetRequestRef.current === requestId) {
        speechAssetRequestRef.current = null;
        setSpeechAssetState("failed");
        restoreSpeechAssetFocus();
      }
    }
  };

  useEffect(() => props.speechAssetApi?.onAssetInstallEvent((event) => {
    if (!speechAssetInstallationRef.current && speechAssetRequestRef.current) {
      speechAssetBufferedEventsRef.current.push(event);
      return;
    }
    applySpeechAssetEvent(event);
  }), [props.speechAssetApi, props.speechLanguageTag]);

  useEffect(() => {
    speechAssetRequestRef.current = null;
    speechAssetInstallationRef.current = null;
    speechAssetSequenceRef.current = 0;
    speechAssetBufferedEventsRef.current = [];
    setSpeechAssetState("idle");
    setSpeechAssetProgress(null);
  }, [props.speechLanguageTag]);

  useEffect(() => () => {
    speechAssetRequestRef.current = null;
    speechAssetInstallationRef.current = null;
    speechAssetBufferedEventsRef.current = [];
  }, []);

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

  const openToolchainReinstall = async (): Promise<void> => {
    if (toolchainReinstallActiveRef.current || toolchainReinstallPending) return;
    if (!props.toolchainHealth?.repair || !props.onOpenToolchainReinstall) return;
    toolchainReinstallActiveRef.current = true;
    setToolchainReinstallPending(true);
    setToolchainReinstallNotice(null);
    try {
      setToolchainReinstallNotice(await props.onOpenToolchainReinstall());
    } catch {
      setToolchainReinstallNotice("failed");
    } finally {
      toolchainReinstallActiveRef.current = false;
      setToolchainReinstallPending(false);
      window.setTimeout(() => (
        toolchainReinstallTriggerRef.current ?? toolchainRefreshTriggerRef.current
      )?.focus(), 0);
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
              ref={toolchainRefreshTriggerRef}
              className="settings-button"
              type="button"
              disabled={refreshing}
              aria-describedby="capabilities-refresh-status"
              onClick={() => void refresh()}
            >
              {props.t(refreshing ? "capabilities.checking" : "capabilities.checkAgain")}
            </button>
          </div>
          {props.toolchainHealth?.repair && props.onOpenToolchainReinstall ? (
            <div className="settings-row" data-toolchain-reinstall>
              <div className="settings-row-copy">
                <strong>{props.t("capabilities.repairTitle")}</strong>
                <span>{props.t("capabilities.repairDescription")}</span>
              </div>
              <div className="settings-row-control">
                <button
                  ref={toolchainReinstallTriggerRef}
                  className="settings-button"
                  type="button"
                  disabled={toolchainReinstallPending}
                  aria-describedby={toolchainReinstallNotice ? "capabilities-toolchain-reinstall-notice" : undefined}
                  onClick={() => void openToolchainReinstall()}
                >
                  {props.t(toolchainReinstallPending
                    ? "capabilities.reinstallOpening"
                    : "capabilities.reinstall")}
                </button>
              </div>
              {toolchainReinstallNotice ? (
                <p
                  className={toolchainReinstallNotice === "failed"
                    ? "settings-inline-status error"
                    : "settings-inline-status"}
                  id="capabilities-toolchain-reinstall-notice"
                  role={toolchainReinstallNotice === "failed" ? "alert" : "status"}
                  aria-live="polite"
                >
                  {props.t(`capabilities.reinstallNotice.${toolchainReinstallNotice}`)}
                </p>
              ) : null}
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
      <section className="settings-section" aria-labelledby="capabilities-reranker-title">
        <h2 className="settings-section-title" id="capabilities-reranker-title">
          {props.t("capabilities.localReranking")}
        </h2>
        <div className="settings-card">
          <LocalRerankerSettingsPanel api={props.rerankerApi} t={props.t} />
        </div>
      </section>

      <section className="settings-section" aria-labelledby="capabilities-input-title">
        <h2 className="settings-section-title" id="capabilities-input-title">
          {props.t("capabilities.ocrAndVoice")}
        </h2>
        <div className="settings-card">
          {ocrEnginePreferenceApi ? (
            <OcrEnginePreferenceControl api={ocrEnginePreferenceApi} t={props.t} />
          ) : null}
          <PaddleOcrLifecyclePanel api={props.paddleOcrApi} t={props.t} />
          {props.ocrLanguagePreferenceApi ? (
            <OcrLanguagePreferenceControl api={props.ocrLanguagePreferenceApi} t={props.t} />
          ) : null}
          {props.ocrImageTestApi ? <OcrImageTestControl api={props.ocrImageTestApi} t={props.t} /> : null}
          {props.ocrSummaryPreferenceApi ? (
            <OcrSummaryPreferenceControl api={props.ocrSummaryPreferenceApi} t={props.t} />
          ) : null}
          {props.dictationLanguagePreferenceApi ? (
            <DictationLanguagePreferenceControl
              api={props.dictationLanguagePreferenceApi}
              {...(props.onDictationLanguagePreferenceChanged
                ? { onPreferenceChanged: props.onDictationLanguagePreferenceChanged }
                : {})}
              t={props.t}
            />
          ) : null}
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("capabilities.voiceTitle")}</strong>
              <span>{props.t("capabilities.voiceDescription")}</span>
            </div>
            <div className="settings-row-control">
              <span
                ref={speechStatusRef}
                className={`settings-status${speechCapabilityState === "available" ? "" : " warning"}`}
                data-capability-status="voice-input"
                tabIndex={-1}
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
              {speechAssetInstallAvailable ? (
                <button
                  ref={speechAssetTriggerRef}
                  className="settings-button"
                  type="button"
                  data-capability-control="voice-install-asset"
                  disabled={speechAssetState === "installing"}
                  onClick={() => void installSpeechAsset()}
                >
                  {props.t(speechAssetState === "installing"
                    ? "capabilities.voice.installingAsset"
                    : "capabilities.voice.installAsset")}
                </button>
              ) : null}
            </div>
          </div>
          {speechAssetState === "installing" || speechAssetState === "failed" ? (
            <p
              className={speechAssetState === "failed" ? "settings-inline-status error" : "settings-inline-status"}
              role={speechAssetState === "failed" ? "alert" : "status"}
              aria-live="polite"
            >
              {props.t(speechAssetState === "failed"
                ? "capabilities.voice.assetInstallFailed"
                : "capabilities.voice.assetInstallProgress")}
              {speechAssetState === "installing" && speechAssetProgress !== null ? ` ${speechAssetProgress}%` : ""}
            </p>
          ) : null}
        </div>
      </section>

      <p className="settings-note" id="capabilities-partial-note">{props.t("capabilities.partialNote")}</p>
    </section>
  );
}
