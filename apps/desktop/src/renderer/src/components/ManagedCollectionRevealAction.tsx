import { useEffect, useRef, useState } from "react";
import type { CollectionRevealRequest, CollectionRevealResult } from "@pige/schemas";

type RevealStatus = CollectionRevealResult["status"] | null;

export function ManagedCollectionRevealAction(props: {
  readonly activeVaultId: string;
  readonly datasetId: string;
  readonly revisionId: string;
  readonly tableId: string;
  readonly onReveal: (request: CollectionRevealRequest) => Promise<CollectionRevealResult>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const ownerKey = `${props.activeVaultId}:${props.datasetId}:${props.revisionId}:${props.tableId}`;
  const ownerRef = useRef(ownerKey);
  const activeRef = useRef(false);
  const sequenceRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<RevealStatus>(null);
  ownerRef.current = ownerKey;

  useEffect(() => {
    sequenceRef.current += 1;
    activeRef.current = false;
    setPending(false);
    setStatus(null);
  }, [ownerKey]);

  const reveal = async (): Promise<void> => {
    if (activeRef.current) return;
    activeRef.current = true;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const requestedOwner = ownerKey;
    const request: CollectionRevealRequest = {
      apiVersion: 1,
      requestId: `collection_reveal_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      datasetId: props.datasetId,
      revisionId: props.revisionId,
      tableId: props.tableId
    };
    setPending(true);
    setStatus(null);
    try {
      const result = await props.onReveal(request);
      if (sequence !== sequenceRef.current || ownerRef.current !== requestedOwner) return;
      setStatus(sameIdentity(request, result) ? result.status : "failed");
    } catch {
      if (sequence === sequenceRef.current && ownerRef.current === requestedOwner) setStatus("failed");
    } finally {
      if (sequence === sequenceRef.current && ownerRef.current === requestedOwner) {
        activeRef.current = false;
        setPending(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
      }
    }
  };

  return <div className="collection-reveal-action">
    <button ref={triggerRef} type="button" className="settings-button" disabled={pending}
      onClick={() => void reveal()}>{props.t(pending ? "collection.reveal.pending" : "collection.reveal.action")}</button>
    {status ? <p className={status === "revealed" ? "muted" : "error"} role="status" aria-live="polite">
      {props.t(`collection.reveal.${status}`)}
    </p> : null}
  </div>;
}

function sameIdentity(request: CollectionRevealRequest, result: CollectionRevealResult): boolean {
  return result.requestId === request.requestId && result.activeVaultId === request.activeVaultId &&
    result.datasetId === request.datasetId && result.revisionId === request.revisionId &&
    result.tableId === request.tableId;
}
