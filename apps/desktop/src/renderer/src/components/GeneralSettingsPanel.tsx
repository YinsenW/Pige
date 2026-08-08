import { useEffect, useRef, useState } from "react";
import type {
  SetStartupDestinationRequest,
  StartupDestinationMutationResult,
  StartupDestinationSummary
} from "@pige/contracts";
import { SettingsProfileTransferPanel, type SettingsProfileTransferApi } from "./SettingsProfileTransferPanel";
type StartupDestination = StartupDestinationSummary["destination"];

export interface StartupDestinationApi {
  readonly load: () => Promise<StartupDestinationSummary>;
  readonly set: (request: SetStartupDestinationRequest) => Promise<StartupDestinationMutationResult>;
}
export function GeneralSettingsPanel(props: {
  readonly alwaysOnTop: boolean | null;
  readonly alwaysOnTopBusy: boolean;
  readonly onAlwaysOnTopChange: () => Promise<void>;
  readonly onOpenAppearance: () => void;
  readonly startupDestinationApi: StartupDestinationApi;
  readonly settingsProfileTransferApi: SettingsProfileTransferApi;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [startupSummary, setStartupSummary] = useState<StartupDestinationSummary | null>(null);
  const [startupDraft, setStartupDraft] = useState<StartupDestination | null>(null);
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupLoadBusy, setStartupLoadBusy] = useState(false);
  const [startupNotice, setStartupNotice] = useState<"stale" | "failed" | "load_failed" | null>(null);
  const startupRequestRef = useRef(false);
  const startupLoadSequenceRef = useRef(0);
  const startupSelectRef = useRef<HTMLSelectElement>(null);
  const restoreStartupFocusRef = useRef(false);
  const loadStartupSummary = (): void => {
    if (startupLoadBusy) return;
    const sequence = ++startupLoadSequenceRef.current;
    setStartupLoadBusy(true);
    void props.startupDestinationApi.load().then((summary) => {
      if (sequence !== startupLoadSequenceRef.current) return;
      setStartupSummary(summary);
      setStartupDraft(summary.destination);
      setStartupNotice(null);
      if (restoreStartupFocusRef.current) {
        restoreStartupFocusRef.current = false;
        const restoreFocus = (): void => startupSelectRef.current?.focus({ preventScroll: true });
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => window.requestAnimationFrame(restoreFocus));
        } else {
          window.setTimeout(() => window.setTimeout(restoreFocus, 0), 0);
        }
      }
    }).catch(() => {
      if (sequence === startupLoadSequenceRef.current) setStartupNotice("load_failed");
    }).finally(() => {
      if (sequence === startupLoadSequenceRef.current) setStartupLoadBusy(false);
    });
  };
  const retryStartupLoad = (): void => {
    restoreStartupFocusRef.current = true;
    loadStartupSummary();
  };

  useEffect(() => {
    loadStartupSummary();
    return () => { startupLoadSequenceRef.current += 1; };
  }, [props.startupDestinationApi]);

  const changeStartupDestination = async (destination: StartupDestination): Promise<void> => {
    const summary = startupSummary;
    if (!summary || startupRequestRef.current) return;
    startupRequestRef.current = true;
    setStartupDraft(destination);
    setStartupBusy(true);
    setStartupNotice(null);
    try {
      const result = await props.startupDestinationApi.set({
        destination,
        expectedRevision: summary.revision
      });
      if (result.summary) setStartupSummary(result.summary);
      if (result.status === "committed") {
        setStartupDraft(result.summary.destination);
      } else {
        setStartupNotice(result.status);
      }
    } catch {
      setStartupNotice("failed");
    } finally {
      startupRequestRef.current = false;
      setStartupBusy(false);
      const restoreFocus = (): void => startupSelectRef.current?.focus({ preventScroll: true });
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => window.requestAnimationFrame(restoreFocus));
      } else {
        window.setTimeout(() => window.setTimeout(restoreFocus, 0), 0);
      }
    }
  };

  return (
    <section className="settings-page settings-general" aria-labelledby="settings-general-title">
      <header className="settings-panel-header">
        <h1 id="settings-general-title">{props.t("settings.general.title")}</h1>
        <p>{props.t("settings.general.subtitle")}</p>
      </header>

      <section className="settings-section" aria-labelledby="settings-general-window-title">
        <h2 className="settings-section-title" id="settings-general-window-title">
          {props.t("settings.general.windowSection")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.startupTitle")}</strong>
              <span id="settings-general-startup-description">{props.t("settings.general.startupDescription")}</span>
              {startupNotice ? <span role="status" aria-live="polite">
                {props.t(`settings.general.startup${startupNotice === "stale" ? "Stale" : startupNotice === "load_failed" ? "LoadFailed" : "Failed"}`)}
              </span> : null}
            </div>
            <select
              ref={startupSelectRef}
              className="settings-select"
              aria-label={props.t("settings.general.startupTitle")}
              aria-describedby="settings-general-startup-description"
              aria-busy={startupBusy || undefined}
              disabled={!startupSummary || startupBusy}
              value={startupDraft ?? "home"}
              onChange={(event) => void changeStartupDestination(event.target.value as StartupDestination)}
            >
              <option value="home">{props.t("settings.general.startupHome")}</option>
              <option value="library">{props.t("settings.general.startupLibrary")}</option>
            </select>
            {startupNotice === "load_failed" ? (
              <button type="button" className="settings-button" disabled={startupLoadBusy} onClick={retryStartupLoad}>
                {props.t("settings.general.startupRetry")}
              </button>
            ) : null}
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.defaultWindowTitle")}</strong>
              <span>{props.t("settings.general.defaultWindowDescription")}</span>
            </div>
            <span className="settings-status">{props.t("settings.general.adaptive")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.rememberWindowTitle")}</strong>
              <span>{props.t("settings.general.rememberWindowDescription")}</span>
            </div>
            <span className="settings-status">{props.t("settings.general.automatic")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.alwaysOnTop")}</strong>
              <span id="settings-general-always-on-top-description">
                {props.t("settings.general.alwaysOnTopDescription")}
              </span>
            </div>
            <button
              type="button"
              className="settings-switch"
              role="switch"
              aria-label={props.t("settings.general.alwaysOnTop")}
              aria-describedby="settings-general-always-on-top-description"
              aria-checked={props.alwaysOnTop ?? false}
              aria-busy={props.alwaysOnTopBusy || undefined}
              disabled={props.alwaysOnTop === null || props.alwaysOnTopBusy}
              onClick={() => void props.onAlwaysOnTopChange()}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.sidebarOnLaunchTitle")}</strong>
              <span id="settings-general-sidebar-on-launch-description">
                {props.t("settings.general.sidebarOnLaunchDescription")}
              </span>
            </div>
            <span className="settings-status">{props.t("settings.general.lastState")}</span>
          </div>
        </div>
      </section>

      <SettingsProfileTransferPanel api={props.settingsProfileTransferApi} t={props.t} />

      <section className="settings-section" aria-labelledby="settings-general-pige-title">
        <h2 className="settings-section-title" id="settings-general-pige-title">
          {props.t("settings.general.pigeSection")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.productTitle")}</strong>
              <span>{props.t("settings.general.productDescription")}</span>
            </div>
            <span className="settings-badge">{props.t("settings.general.preAlpha")}</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("settings.general.appearanceTitle")}</strong>
              <span>{props.t("settings.general.appearanceDescription")}</span>
            </div>
            <button className="settings-button" type="button" onClick={props.onOpenAppearance}>
              {props.t("settings.general.openAppearance")}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
