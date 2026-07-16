import { useEffect, useRef } from "react";

export type HomeVoicePanelState = "recording" | "unsupported" | "permission_denied";

interface HomeVoicePanelProps {
  readonly state: HomeVoicePanelState;
  readonly transcript?: string;
  readonly onStop?: () => void;
  readonly onComplete?: () => void;
  readonly onDismiss: () => void;
  readonly onOpenSystemSettings?: () => void;
  readonly t: (key: string) => string;
}

export function HomeVoicePanel({
  state,
  transcript,
  onStop,
  onComplete,
  onDismiss,
  onOpenSystemSettings,
  t
}: HomeVoicePanelProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state]);

  const recording = state === "recording";
  const permissionDenied = state === "permission_denied";
  const titleKey = recording
    ? "home.voice.recordingTitle"
    : permissionDenied
      ? "home.voice.permissionTitle"
      : "home.voice.unsupportedTitle";
  const descriptionKey = recording
    ? "home.voice.recordingDescription"
    : permissionDenied
      ? "home.voice.permissionDescription"
      : "home.voice.unsupportedDescription";

  return (
    <section
      id="home-voice-panel"
      className={`home-voice-panel state-${state}`}
      role={permissionDenied ? "alert" : "status"}
      aria-live={permissionDenied ? "assertive" : "polite"}
      aria-atomic="true"
      aria-labelledby="home-voice-panel-title"
      aria-describedby="home-voice-panel-description"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDismiss();
      }}
    >
      <span className="home-voice-eyebrow">
        {t(recording
          ? "home.voice.listening"
          : permissionDenied
            ? "home.voice.permissionEyebrow"
            : "home.voice.unsupportedEyebrow")}
      </span>
      <h2 id="home-voice-panel-title" ref={headingRef} tabIndex={-1}>
        {recording && transcript ? transcript : t(titleKey)}
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
            <button className="quiet" type="button" onClick={onStop}>{t("home.voice.stop")}</button>
            <button className="primary" type="button" onClick={onComplete}>{t("home.voice.complete")}</button>
          </>
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
          </>
        )}
      </div>
    </section>
  );
}
