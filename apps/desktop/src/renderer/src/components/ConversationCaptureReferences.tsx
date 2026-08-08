import { useEffect, useRef, useState } from "react";
import type { AgentConversationMessage } from "@pige/contracts";

export function ConversationCaptureReferences(props: {
  readonly references: NonNullable<AgentConversationMessage["captureReferences"]>;
  readonly onOpen: (pageId: string) => Promise<void> | void;
  readonly t: (key: string) => string;
}) {
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [failedEventId, setFailedEventId] = useState<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const ownerKey = props.references.map((reference) => `${reference.eventId}:${reference.pageId ?? ""}`).join("|");

  useEffect(() => {
    sequenceRef.current += 1;
    openingRef.current = null;
    setOpeningEventId(null);
    setFailedEventId(null);
  }, [ownerKey]);

  useEffect(() => () => {
    sequenceRef.current += 1;
    openingRef.current = null;
  }, []);

  const openReference = async (
    reference: NonNullable<AgentConversationMessage["captureReferences"]>[number]
  ): Promise<void> => {
    if (!reference.pageId || openingRef.current) return;
    const sequence = ++sequenceRef.current;
    openingRef.current = reference.eventId;
    setOpeningEventId(reference.eventId);
    setFailedEventId(null);
    try {
      await props.onOpen(reference.pageId);
      if (sequence !== sequenceRef.current || openingRef.current !== reference.eventId) return;
    } catch {
      if (sequence === sequenceRef.current && openingRef.current === reference.eventId) {
        setFailedEventId(reference.eventId);
      }
    } finally {
      if (sequence !== sequenceRef.current || openingRef.current !== reference.eventId) return;
      openingRef.current = null;
      setOpeningEventId(null);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() =>
        triggerRefs.current.get(reference.eventId)?.focus({ preventScroll: true })));
    }
  };

  return (
    <div className="conversation-attachment-list" aria-label={props.t("home.attachedFiles")}>
      {props.references.map((reference) => (
        <span className="conversation-attachment" key={reference.eventId}>
          {reference.displayName}
          {reference.pageId ? (
            <>
              <button
                ref={(element) => {
                  if (element) triggerRefs.current.set(reference.eventId, element);
                  else triggerRefs.current.delete(reference.eventId);
                }}
                type="button"
                className="button-quiet"
                disabled={openingEventId !== null}
                aria-busy={openingEventId === reference.eventId || undefined}
                onClick={() => void openReference(reference)}
              >
                {openingEventId === reference.eventId ? props.t("note.opening") : props.t("activity.open")}
              </button>
              {failedEventId === reference.eventId ? <span role="alert" aria-live="polite">{props.t("error.generic")}</span> : null}
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}
