import { useEffect, useRef } from "react";

export type HomeVoicePanelState =
  | "requesting_permission"
  | "recording"
  | "stopped"
  | "transcribing"
  | "ready"
  | "unsupported"
  | "permission_denied"
  | "failed";

interface HomeVoicePanelProps {
  readonly state: HomeVoicePanelState;
  readonly transcript?: string;
  readonly onStop?: () => void;
  readonly onComplete?: () => void;
  readonly onRetry?: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSystemSettings?: () => void;
  readonly t: (key: string) => string;
}

export function HomeVoicePanel({
  state,
  transcript,
  onStop,
  onComplete,
  onRetry,
  onDismiss,
  onOpenSystemSettings,
  t
}: HomeVoicePanelProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state]);

  const recording = state === "recording";
  const stopped = state === "stopped";
  const transcribing = state === "transcribing";
  const ready = state === "ready";
  const requestingPermission = state === "requesting_permission";
  const permissionDenied = state === "permission_denied";
  const failed = state === "failed";
  const busy = requestingPermission || transcribing;
  const titleKey = stateTitleKey(state);
  const descriptionKey = stateDescriptionKey(state);
  const eyebrowKey = stateEyebrowKey(state);
  const transcriptVisible = recording || stopped || transcribing || ready;
  const transcriptReady = Boolean(transcript?.trim()) && (stopped || ready);

  return (
    <section
      id="home-voice-panel"
      className={`home-voice-panel state-${state}`}
      role={permissionDenied || failed ? "alert" : "status"}
      aria-live={permissionDenied || failed ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={busy}
      aria-labelledby="home-voice-panel-title"
      aria-describedby="home-voice-panel-description"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDismiss();
      }}
    >
      <span className="home-voice-eyebrow">
        {t(eyebrowKey)}
      </span>
      <h2 id="home-voice-panel-title" ref={headingRef} tabIndex={-1}>
        {transcriptVisible && transcript ? transcript : t(titleKey)}
      </h2>
      {recording ? (
        <div className="home-voice-wave" aria-hidden="true">
          <span /><span /><span /><span /><span /><span />
        </div>
      ) : null}
      <p id="home-voice-panel-description">{t(descriptionKey)}</p>
      <div className="home-voice-actions">
        {recording ? (
          <>
            <button className="quiet" type="button" disabled={!onStop} onClick={onStop}>{t("home.voice.stop")}</button>
            <button className="primary" type="button" disabled={!onComplete} onClick={onComplete}>{t("home.voice.complete")}</button>
          </>
        ) : stopped || ready ? (
          <>
            <button className="quiet" type="button" onClick={onDismiss}>{t("home.voice.cancel")}</button>
            <button className="primary" type="button" disabled={!transcriptReady || !onComplete} onClick={onComplete}>
              {t("home.voice.useTranscript")}
            </button>
          </>
        ) : requestingPermission || transcribing ? (
          <button className="quiet" type="button" onClick={onDismiss}>{t("home.voice.cancel")}</button>
        ) : (
          <>
            <button className="quiet" type="button" onClick={onDismiss}>{t("home.voice.continueTyping")}</button>
            {permissionDenied ? (
              <button
                className="primary"
                type="button"
                disabled={!onOpenSystemSettings}
                onClick={onOpenSystemSettings}
              >
                {t("home.voice.openSystemSettings")}
              </button>
            ) : null}
            {failed ? (
              <button className="primary" type="button" disabled={!onRetry} onClick={onRetry}>
                {t("home.voice.retry")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function stateTitleKey(state: HomeVoicePanelState): string {
  switch (state) {
    case "requesting_permission": return "home.voice.requestingPermissionTitle";
    case "recording": return "home.voice.recordingTitle";
    case "stopped": return "home.voice.stoppedTitle";
    case "transcribing": return "home.voice.transcribingTitle";
    case "ready": return "home.voice.readyTitle";
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
    case "permission_denied": return "home.voice.permissionDescription";
    case "failed": return "home.voice.failedDescription";
    case "unsupported": return "home.voice.unsupportedDescription";
  }
}

function stateEyebrowKey(state: HomeVoicePanelState): string {
  switch (state) {
    case "requesting_permission": return "home.voice.requestingPermissionEyebrow";
    case "recording": return "home.voice.listening";
    case "stopped": return "home.voice.stoppedEyebrow";
    case "transcribing": return "home.voice.transcribingEyebrow";
    case "ready": return "home.voice.readyEyebrow";
    case "permission_denied": return "home.voice.permissionEyebrow";
    case "failed": return "home.voice.failedEyebrow";
    case "unsupported": return "home.voice.unsupportedEyebrow";
  }
}
