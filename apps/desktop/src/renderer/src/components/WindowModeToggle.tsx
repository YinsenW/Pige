import { useRef } from "react";
import type { WindowState } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

interface WindowModeToggleProps {
  readonly state: WindowState | null;
  readonly compactLabel: string;
  readonly expandedLabel: string;
  readonly tabIndex: number | undefined;
  readonly onStateChange: (state: WindowState) => void;
}

export function WindowModeToggle(props: WindowModeToggleProps): React.JSX.Element {
  const busyRef = useRef(false);
  const compact = props.state?.mode === "compact";
  const label = compact ? props.expandedLabel : props.compactLabel;
  const toggle = async (): Promise<void> => {
    if (!props.state || busyRef.current) return;
    busyRef.current = true;
    try {
      props.onStateChange(await window.pige.window.setMode({ mode: compact ? "expanded" : "compact" }));
    } catch {
      // The main-process owner keeps the prior window state on failure.
    } finally {
      busyRef.current = false;
    }
  };
  return (
    <button type="button" className="icon-button window-mode-button" aria-label={label} title={label}
      tabIndex={props.tabIndex} disabled={!props.state} onClick={() => void toggle()}>
      <PigeIcon name={compact ? "windowWide" : "windowNarrow"} />
    </button>
  );
}
