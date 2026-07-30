import { useEffect, useRef, useState, type RefObject } from "react";

export type BackupDestinationReconnectOutcome =
  | "reconnected"
  | "cancelled"
  | "stale"
  | "not_found"
  | "ineligible"
  | "failed";

export interface BackupDestinationReconnectActionProps {
  readonly identityKey: string;
  readonly eligible: boolean;
  readonly disabled?: boolean;
  readonly labels: {
    readonly action: string;
    readonly pending: string;
    readonly reconnected: string;
    readonly stale: string;
    readonly failed: string;
  };
  readonly onReconnect: () => Promise<BackupDestinationReconnectOutcome>;
  readonly onReconnected: () => Promise<void>;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

export function BackupDestinationReconnectAction(
  props: BackupDestinationReconnectActionProps
): React.JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string } | null>(null);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentIdentityRef = useRef(props.identityKey);
  const previousEligibleRef = useRef(props.eligible);

  currentIdentityRef.current = props.identityKey;

  const restoreFocus = (): void => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
      (triggerRef.current ?? props.returnFocusRef.current)?.focus()));
  };

  useEffect(() => {
    const lostEligibility = previousEligibleRef.current && !props.eligible;
    const wasActive = requestActiveRef.current;
    previousEligibleRef.current = props.eligible;
    requestSequenceRef.current += 1;
    requestActiveRef.current = false;
    setPending(false);
    setNotice(null);
    props.onPendingChange?.(false);
    if (lostEligibility || wasActive) restoreFocus();
  }, [props.eligible, props.identityKey]);

  const reconnect = async (): Promise<void> => {
    if (!props.eligible || props.disabled || requestActiveRef.current) return;
    requestActiveRef.current = true;
    const sequence = ++requestSequenceRef.current;
    const identityKey = props.identityKey;
    setPending(true);
    setNotice(null);
    props.onPendingChange?.(true);
    try {
      const outcome = await props.onReconnect();
      if (sequence !== requestSequenceRef.current || currentIdentityRef.current !== identityKey) return;
      if (outcome === "reconnected") {
        setNotice({ kind: "status", text: props.labels.reconnected });
        await props.onReconnected().catch(() => undefined);
      } else if (outcome === "cancelled") {
        setNotice(null);
      } else if (outcome === "stale" || outcome === "not_found" || outcome === "ineligible") {
        setNotice({ kind: "error", text: props.labels.stale });
      } else {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } catch {
      if (sequence === requestSequenceRef.current && currentIdentityRef.current === identityKey) {
        setNotice({ kind: "error", text: props.labels.failed });
      }
    } finally {
      if (sequence === requestSequenceRef.current && currentIdentityRef.current === identityKey) {
        requestActiveRef.current = false;
        setPending(false);
        props.onPendingChange?.(false);
        restoreFocus();
      }
    }
  };

  if (!props.eligible) return null;
  return <div className="settings-row-control">
    <button ref={triggerRef} className="settings-button" type="button" disabled={props.disabled || pending}
      aria-busy={pending || undefined} onClick={() => void reconnect()}>
      {pending ? props.labels.pending : props.labels.action}
    </button>
    {notice ? <span className={notice.kind === "error" ? "error" : "settings-status"}
      role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</span> : null}
  </div>;
}
