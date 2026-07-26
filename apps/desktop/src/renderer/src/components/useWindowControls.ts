import { useRef, useState } from "react";
import type { WindowState } from "@pige/contracts";

interface WindowControls {
  readonly busy: boolean;
  readonly toggleAlwaysOnTop: () => Promise<void>;
  readonly toggleWindowMode: () => Promise<void>;
}

export function useWindowControls(
  state: WindowState | null,
  setState: (state: WindowState) => void,
  onFailure: () => void
): WindowControls {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = async (request: () => Promise<WindowState>): Promise<void> => {
    if (!state || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      setState(await request());
    } catch {
      onFailure();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return {
    busy,
    toggleAlwaysOnTop: () => run(() => window.pige.window.setAlwaysOnTop({ alwaysOnTop: !state?.alwaysOnTop })),
    toggleWindowMode: () => run(() => window.pige.window.setMode({
      mode: state?.mode === "compact" ? "expanded" : "compact"
    }))
  };
}
