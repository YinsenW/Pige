import type { WindowState } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

interface WindowModeToggleProps {
  readonly state: WindowState | null;
  readonly compactLabel: string;
  readonly expandedLabel: string;
  readonly tabIndex: number | undefined;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

export function WindowModeToggle(props: WindowModeToggleProps): React.JSX.Element {
  const compact = props.state?.mode === "compact";
  const label = compact ? props.expandedLabel : props.compactLabel;
  return (
    <button type="button" className="icon-button window-mode-button" aria-label={label} title={label}
      tabIndex={props.tabIndex} aria-busy={props.busy || undefined} disabled={!props.state || props.busy}
      onClick={props.onToggle}>
      <PigeIcon name="pictureInPicture2" />
    </button>
  );
}
