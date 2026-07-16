import { useEffect, useRef } from "react";

export type HomeVoicePanelState =
  | "requesting_permission"
  | "recording"
  | "stopped"
  | "transcribing"
  | "ready"
  | "assets_unavailable"
  | "installing_asset"
  | "asset_ready"
  | "asset_install_failed"
  | "unsupported"
  | "permission_denied"
  | "failed";

interface HomeVoicePanelProps {
  readonly state: HomeVoicePanelState;
  readonly transcript?: string;
  readonly elapsedMs?: number;
  readonly levels?: readonly number[];
  readonly assetInstallProgress?: number;
  readonly onTranscriptChange?: (value: string) => void;
  readonly onAttach?: () => void;
  readonly onStop?: () => void;
  readonly onComplete?: () => void;
  readonly onRetry?: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSystemSettings?: () => void;
  readonly onInstallLanguageAsset?: () => void;
  readonly onStartAfterAssetInstall?: () => void;
  readonly t: (key: string) => string;
}

export function HomeVoicePanel({
  state,
  transcript,
  elapsedMs,
  levels,
  assetInstallProgress,
  onTranscriptChange,
  onAttach,
  onStop,
  onComplete,
  onRetry,
  onDismiss,
  onOpenSystemSettings,
  onInstallLanguageAsset,
  onStartAfterAssetInstall,
  t
}: HomeVoicePanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLElement>(null);
  const recording = state === "recording";
  const stopped = state === "stopped";
  const transcribing = state === "transcribing";
  const ready = state === "ready";
  const requestingPermission = state === "requesting_permission";
  const permissionDenied = state === "permission_denied";
  const failed = state === "failed";
  const unsupported = state === "unsupported";
  const assetsUnavailable = state === "assets_unavailable";
  const installingAsset = state === "installing_asset";
  const assetReady = state === "asset_ready";
  const assetInstallFailed = state === "asset_install_failed";
  const busy = requestingPermission || transcribing || installingAsset;
  const alert = permissionDenied || failed || assetInstallFailed;
  const transcriptReady = Boolean(transcript?.trim()) && (stopped || ready);
  const waveform = normalizeLevels(levels);

  useEffect(() => {
    if (installingAsset) panelRef.current?.focus();
  }, [installingAsset]);

  return (
    <section
      ref={panelRef}
      id="home-voice-panel"
      className={`home-voice-panel home-voice-inline state-${state}`}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      aria-atomic={alert ? "true" : undefined}
      aria-busy={busy}
      aria-label={t(stateTitleKey(state))}
      tabIndex={installingAsset ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (installingAsset) return;
        onDismiss();
      }}
    >
      {recording ? (
        <div className="home-voice-recording-row">
          <button
            className="home-voice-add"
            type="button"
            aria-label={t("home.attachFile")}
            title={t("home.attachFile")}
            disabled={!onAttach}
            onClick={onAttach}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 3.5v13M3.5 10h13" />
            </svg>
          </button>
          <div
            className={waveform.length > 0 ? "home-voice-wave has-levels" : "home-voice-wave is-neutral"}
            aria-hidden="true"
          >
            {(waveform.length > 0 ? waveform : NEUTRAL_LEVELS).map((level, index) => (
              <span key={index} style={{ height: `${Math.round(2 + level * 30)}px` }} />
            ))}
          </div>
          {elapsedMs === undefined ? null : (
            <span className="home-voice-timer" aria-label={`${t("home.voice.duration")}: ${formatDuration(elapsedMs)}`}>
              {formatDuration(elapsedMs)}
            </span>
          )}
          <button
            className="home-voice-icon-action stop"
            type="button"
            aria-label={t("home.voice.stop")}
            title={t("home.voice.stop")}
            disabled={!onStop}
            onClick={onStop}
          >
            <span aria-hidden="true" />
          </button>
          <button
            className="home-voice-icon-action complete"
            type="button"
            aria-label={t("home.voice.complete")}
            title={t("home.voice.complete")}
            disabled={!onComplete}
            onClick={onComplete}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 15.5v-11m0 0L5.75 8.75M10 4.5l4.25 4.25" />
            </svg>
          </button>
          <span className="visually-hidden">{t("home.voice.recordingDescription")}</span>
          {transcript ? <span className="visually-hidden">{transcript}</span> : null}
        </div>
      ) : stopped || ready ? (
        <div className="home-voice-transcript-state">
          <textarea
            className="home-voice-transcript"
            value={transcript ?? ""}
            readOnly={!onTranscriptChange}
            aria-label={t("home.voice.transcript")}
            onInput={(event) => onTranscriptChange?.(event.currentTarget.value)}
          />
          <div className="home-voice-inline-footer">
            <span>{t(state === "ready" ? "home.voice.readyDescription" : "home.voice.stoppedDescription")}</span>
            <button className="quiet" type="button" onClick={onDismiss}>{t("home.voice.cancel")}</button>
            <button
              className="primary"
              type="button"
              disabled={!transcriptReady || !onComplete}
              onClick={onComplete}
            >
              {t("home.voice.useTranscript")}
            </button>
          </div>
        </div>
      ) : (
        <div className="home-voice-inline-notice">
          <div className="home-voice-inline-copy">
            <strong>{transcribing && transcript ? transcript : t(stateTitleKey(state))}</strong>
            <span>{t(stateDescriptionKey(state))}</span>
            {installingAsset && assetInstallProgress !== undefined ? (
              <div className="home-voice-asset-progress-wrap">
                <div
                  className="home-voice-asset-progress"
                  role="progressbar"
                  aria-label={t("home.voice.assetInstallProgress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={normalizeProgress(assetInstallProgress)}
                  aria-valuetext={`${t("home.voice.assetInstallProgress")}: ${normalizeProgress(assetInstallProgress)}%`}
                >
                  <span style={{ width: `${normalizeProgress(assetInstallProgress)}%` }} />
                </div>
                <span aria-hidden="true">{normalizeProgress(assetInstallProgress)}%</span>
              </div>
            ) : null}
          </div>
          <div className="home-voice-inline-actions">
            {installingAsset ? null : (
              <button className="quiet" type="button" onClick={onDismiss}>
                {t(requestingPermission || transcribing ? "home.voice.cancel" : "home.voice.continueTyping")}
              </button>
            )}
            {permissionDenied ? (
              <button className="primary" type="button" disabled={!onOpenSystemSettings} onClick={onOpenSystemSettings}>
                {t("home.voice.openSystemSettings")}
              </button>
            ) : null}
            {failed ? (
              <button className="primary" type="button" disabled={!onRetry} onClick={onRetry}>
                {t("home.voice.retry")}
              </button>
            ) : null}
            {assetsUnavailable || assetInstallFailed ? (
              <button
                className="primary"
                type="button"
                disabled={!onInstallLanguageAsset}
                onClick={onInstallLanguageAsset}
              >
                {t("home.voice.installLanguageAsset")}
              </button>
            ) : null}
            {assetReady ? (
              <button
                className="primary"
                type="button"
                disabled={!onStartAfterAssetInstall}
                onClick={onStartAfterAssetInstall}
              >
                {t("home.voice.startAfterAssetInstall")}
              </button>
            ) : null}
          </div>
          {unsupported ? <span className="visually-hidden">{t("home.voice.unsupportedEyebrow")}</span> : null}
        </div>
      )}
    </section>
  );
}

const NEUTRAL_LEVELS = [0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12];

function normalizeLevels(levels: readonly number[] | undefined): number[] {
  if (!levels) return [];
  return levels.slice(-64).map((level) => Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0);
}

function formatDuration(elapsedMs: number): string {
  const bounded = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  const minutes = Math.floor(bounded / 60);
  return `${minutes}:${String(bounded % 60).padStart(2, "0")}`;
}

function stateTitleKey(state: HomeVoicePanelState): string {
  switch (state) {
    case "requesting_permission": return "home.voice.requestingPermissionTitle";
    case "recording": return "home.voice.recordingTitle";
    case "stopped": return "home.voice.stoppedTitle";
    case "transcribing": return "home.voice.transcribingTitle";
    case "ready": return "home.voice.readyTitle";
    case "assets_unavailable": return "home.voice.assetsUnavailableTitle";
    case "installing_asset": return "home.voice.installingAssetTitle";
    case "asset_ready": return "home.voice.assetReadyTitle";
    case "asset_install_failed": return "home.voice.assetInstallFailedTitle";
    case "permission_denied": return "home.voice.permissionTitle";
    case "failed": return "home.voice.failedTitle";
    case "unsupported": return "home.voice.unsupportedTitle";
  }
}

function stateDescriptionKey(state: HomeVoicePanelState): string {
  switch (state) {
    case "requesting_permission": return "home.voice.requestingPermissionDescription";
    case "recording": return "home.voice.recordingDescription";
    case "stopped": return "home.voice.stoppedDescription";
    case "transcribing": return "home.voice.transcribingDescription";
    case "ready": return "home.voice.readyDescription";
    case "assets_unavailable": return "home.voice.assetsUnavailableDescription";
    case "installing_asset": return "home.voice.installingAssetDescription";
    case "asset_ready": return "home.voice.assetReadyDescription";
    case "asset_install_failed": return "home.voice.assetInstallFailedDescription";
    case "permission_denied": return "home.voice.permissionDescription";
    case "failed": return "home.voice.failedDescription";
    case "unsupported": return "home.voice.unsupportedDescription";
  }
}

function normalizeProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.round(Math.min(100, Math.max(0, progress))) : 0;
}
