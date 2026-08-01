import type { AgentConversationMessage } from "@pige/contracts";

export function ConversationCaptureReferences(props: {
  readonly references: NonNullable<AgentConversationMessage["captureReferences"]>;
  readonly onOpen: (pageId: string) => void;
  readonly t: (key: string) => string;
}) {
  return (
    <div className="conversation-attachment-list" aria-label={props.t("home.attachedFiles")}>
      {props.references.map((reference) => (
        <span className="conversation-attachment" key={reference.eventId}>
          {reference.displayName}
          {reference.pageId ? (
            <button type="button" className="button-quiet" onClick={() => props.onOpen(reference.pageId!)}>
              {props.t("activity.open")}
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
