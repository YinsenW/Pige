import type { WindowState } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

interface ReaderFullscreenToggleProps {
  readonly state: WindowState | null;
  readonly visible: boolean;
  readonly enterLabel: string;
  readonly exitLabel: string;
  readonly tabIndex: number | undefined;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

export function ReaderFullscreenToggle(props: ReaderFullscreenToggleProps): React.JSX.Element | null {
  if (!props.visible) return null;
  const fullScreen = props.state?.isFullScreen ?? false;
  const label = fullScreen ? props.exitLabel : props.enterLabel;
  return (
    <button
      type="button"
      className="icon-button reader-fullscreen-button"
      aria-label={label}
      title={label}
      aria-pressed={fullScreen}
      aria-busy={props.busy || undefined}
      disabled={!props.state || props.busy}
      tabIndex={props.tabIndex}
      onClick={props.onToggle}
    >
      <PigeIcon name={fullScreen ? "exitFullscreen" : "fullscreen"} />
    </button>
  );
}
