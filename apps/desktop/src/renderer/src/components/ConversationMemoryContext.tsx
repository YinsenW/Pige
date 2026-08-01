import type { AgentTurnAnswer } from "@pige/contracts";

export function ConversationMemoryContext(props: {
  readonly answer: AgentTurnAnswer | undefined;
  readonly children?: React.ReactNode;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const usage = props.answer?.memoryContext;
  return (
    <>
      {props.children}
      {usage ? (
        <p className="muted" data-memory-context-kind={usage.kind} data-memory-context-count={usage.count}>
          {props.t("home.memoryContextIncluded")} {usage.count}
        </p>
      ) : null}
    </>
  );
}
