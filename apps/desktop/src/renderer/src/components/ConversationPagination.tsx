import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject
} from "react";
import type {
  AgentConversationEarlierPage,
  AgentConversationInitialTimeline,
  AgentConversationMessage,
  AgentSubmitTurnResult,
  AgentTurnScope
} from "@pige/contracts";

type CompletedTurn = Extract<AgentSubmitTurnResult, { readonly state: "completed" }>;

type PaginationState = {
  readonly ownerKey: string;
  readonly conversationId?: string;
  readonly snapshotTailEventId?: string;
  readonly messages: readonly AgentConversationMessage[];
  readonly hasEarlier: boolean;
  readonly nextEarlierCursor?: string;
  readonly revision: number;
};

type PendingRestore = {
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly firstPrependedId?: string;
  readonly keepButtonFocus: boolean;
  readonly trigger: HTMLButtonElement;
};

export type ConversationPaginationController = {
  readonly messages: readonly AgentConversationMessage[];
  readonly hasEarlier: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly loadEarlier: (trigger: HTMLButtonElement) => Promise<void>;
  readonly revealEvent: (eventId: string) => Promise<boolean>;
};

export function projectCompletedConversation(
  current: AgentConversationInitialTimeline | undefined,
  outcome: CompletedTurn,
  createdAt: string,
  userText: string
): AgentConversationInitialTimeline {
  const currentMessages = current?.conversationId === outcome.conversationId ? current.messages : [];
  return {
    kind: "initial",
    conversationId: outcome.conversationId,
    snapshotTailEventId: outcome.tailEventId,
    tailEventId: outcome.tailEventId,
    canFollowUp: true,
    messages: [
      ...currentMessages.filter((message) => message.id !== outcome.conversationEventId && message.id !== outcome.tailEventId),
      { id: outcome.conversationEventId, role: "user", createdAt, text: userText, jobId: outcome.jobId },
      { id: outcome.tailEventId, role: "assistant", createdAt, text: outcome.answer.answer, jobId: outcome.jobId, answer: outcome.answer }
    ],
    hasEarlier: false,
    latestTurn: { jobId: outcome.jobId, userEventId: outcome.conversationEventId, state: "completed" }
  };
}

export function useConversationPagination(input: {
  readonly ownerKey: string;
  readonly initial: AgentConversationInitialTimeline | undefined;
  readonly scope?: AgentTurnScope;
  readonly scrollRef: RefObject<HTMLElement | null>;
}): ConversationPaginationController {
  const [state, setState] = useState<PaginationState>(() => emptyState(input.ownerKey));
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const stateRef = useRef(state);
  const latestInputRef = useRef(input);
  const requestSequenceRef = useRef(0);
  const requestActiveRef = useRef(false);
  const pendingRestoreRef = useRef<PendingRestore | null>(null);
  const pendingRevealRef = useRef<string | null>(null);
  stateRef.current = state;
  latestInputRef.current = input;

  useLayoutEffect(() => {
    const initial = input.initial;
    const current = stateRef.current;
    const identityChanged = current.ownerKey !== input.ownerKey || (
      initial !== undefined &&
      current.conversationId !== undefined &&
      current.conversationId !== initial.conversationId
    );
    if (identityChanged) {
      requestSequenceRef.current += 1;
      requestActiveRef.current = false;
      setLoading(false);
      setFailed(false);
      setState(initial ? stateFromInitial(input.ownerKey, initial, current.revision + 1) : emptyState(input.ownerKey, current.revision + 1));
      return;
    }
    if (!initial) {
      if (current.conversationId === undefined) return;
      requestSequenceRef.current += 1;
      requestActiveRef.current = false;
      setLoading(false);
      setFailed(false);
      setState(emptyState(input.ownerKey, current.revision + 1));
      return;
    }
    const snapshotChanged = current.snapshotTailEventId !== undefined &&
      current.snapshotTailEventId !== initial.snapshotTailEventId;
    if (snapshotChanged) {
      requestSequenceRef.current += 1;
      requestActiveRef.current = false;
      setLoading(false);
      setFailed(false);
    }
    const messages = mergeAppended(current.messages, initial.messages);
    const adoptInitialPage = current.conversationId === undefined || snapshotChanged;
    const hasEarlier = adoptInitialPage ? initial.hasEarlier : current.hasEarlier;
    const nextEarlierCursor = adoptInitialPage ? initial.nextEarlierCursor : current.nextEarlierCursor;
    if (
      current.conversationId === initial.conversationId &&
      current.snapshotTailEventId === initial.snapshotTailEventId &&
      current.hasEarlier === hasEarlier &&
      current.nextEarlierCursor === nextEarlierCursor &&
      messages === current.messages
    ) return;
    setState({
      ownerKey: input.ownerKey,
      conversationId: initial.conversationId,
      snapshotTailEventId: initial.snapshotTailEventId,
      messages,
      hasEarlier,
      ...(nextEarlierCursor ? { nextEarlierCursor } : {}),
      revision: current.revision + 1
    });
  }, [input.initial, input.ownerKey]);

  useLayoutEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending) return;
    pendingRestoreRef.current = null;
    const scroller = input.scrollRef.current;
    if (scroller) {
      scroller.scrollTop = pending.scrollTop + scroller.scrollHeight - pending.scrollHeight;
    }
    window.requestAnimationFrame(() => {
      if (pending.keepButtonFocus && pending.trigger.isConnected) {
        pending.trigger.focus({ preventScroll: true });
        return;
      }
      const firstPrepended = Array.from(
        input.scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []
      ).find((element) => element.dataset.messageId === pending.firstPrependedId);
      (firstPrepended ?? input.scrollRef.current)?.focus({ preventScroll: true });
    });
  }, [input.scrollRef, state.revision]);

  useLayoutEffect(() => {
    const eventId = pendingRevealRef.current;
    if (!eventId) return;
    const target = Array.from(
      input.scrollRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? []
    ).find((element) => element.dataset.messageId === eventId);
    if (!target) return;
    pendingRevealRef.current = null;
    target.scrollIntoView?.({ block: "center" });
    target.focus({ preventScroll: true });
  }, [input.scrollRef, state.revision]);

  const loadEarlier = async (trigger: HTMLButtonElement): Promise<void> => {
    const current = stateRef.current;
    const initial = latestInputRef.current.initial;
    if (
      requestActiveRef.current ||
      !initial ||
      current.ownerKey !== latestInputRef.current.ownerKey ||
      current.conversationId !== initial.conversationId ||
      current.snapshotTailEventId !== initial.snapshotTailEventId ||
      !current.hasEarlier ||
      !current.nextEarlierCursor
    ) return;
    requestActiveRef.current = true;
    setLoading(true);
    setFailed(false);
    const sequence = ++requestSequenceRef.current;
    const ownerKey = current.ownerKey;
    const conversationId = current.conversationId;
    const snapshotTailEventId = current.snapshotTailEventId;
    const scrollerAtStart = latestInputRef.current.scrollRef.current;
    const scrollHeightAtStart = scrollerAtStart?.scrollHeight ?? 0;
    const scrollTopAtStart = scrollerAtStart?.scrollTop ?? 0;
    try {
      const page = await window.pige.agent.conversation({
        conversationId,
        snapshotTailEventId,
        earlierCursor: current.nextEarlierCursor,
        limit: 100,
        ...(latestInputRef.current.scope ? { scope: latestInputRef.current.scope } : {})
      });
      if (
        sequence !== requestSequenceRef.current ||
        !isCurrentPage(ownerKey, conversationId, snapshotTailEventId, page, latestInputRef.current, stateRef.current)
      ) return;
      const existingIds = new Set(stateRef.current.messages.map((message) => message.id));
      const firstPrependedId = page.messages.find((message) => !existingIds.has(message.id))?.id;
      pendingRestoreRef.current = {
        scrollHeight: scrollHeightAtStart,
        scrollTop: scrollTopAtStart,
        ...(firstPrependedId ? { firstPrependedId } : {}),
        keepButtonFocus: page.hasEarlier,
        trigger
      };
      setState((latest) => {
        const { nextEarlierCursor: _discardedCursor, ...retained } = latest;
        return {
          ...retained,
          messages: prependUnique(page.messages, latest.messages),
          hasEarlier: page.hasEarlier,
          ...(page.nextEarlierCursor ? { nextEarlierCursor: page.nextEarlierCursor } : {}),
          revision: latest.revision + 1
        };
      });
    } catch {
      const latest = latestInputRef.current;
      if (
        sequence === requestSequenceRef.current &&
        latest.ownerKey === ownerKey &&
        latest.initial?.conversationId === conversationId &&
        latest.initial.snapshotTailEventId === snapshotTailEventId
      ) setFailed(true);
    } finally {
      if (sequence === requestSequenceRef.current) {
        requestActiveRef.current = false;
        setLoading(false);
      }
    }
  };

  const revealEvent = async (eventId: string): Promise<boolean> => {
    if (!/^evt_\d{8}_[a-z0-9]{8,}$/u.test(eventId) || requestActiveRef.current) return false;
    const initial = latestInputRef.current.initial;
    const current = stateRef.current;
    if (!initial || current.ownerKey !== latestInputRef.current.ownerKey ||
      current.conversationId !== initial.conversationId ||
      current.snapshotTailEventId !== initial.snapshotTailEventId) return false;
    if (current.messages.some((message) => message.id === eventId)) {
      pendingRevealRef.current = eventId;
      setState({ ...current, revision: current.revision + 1 });
      return true;
    }
    requestActiveRef.current = true;
    setLoading(true);
    setFailed(false);
    const sequence = ++requestSequenceRef.current;
    let messages = current.messages;
    let hasEarlier = current.hasEarlier;
    let cursor = current.nextEarlierCursor;
    try {
      for (let pageCount = 0; pageCount < 1_024 && hasEarlier && cursor; pageCount += 1) {
        const page = await window.pige.agent.conversation({
          conversationId: initial.conversationId,
          snapshotTailEventId: initial.snapshotTailEventId,
          earlierCursor: cursor,
          limit: 100,
          ...(latestInputRef.current.scope ? { scope: latestInputRef.current.scope } : {})
        });
        if (sequence !== requestSequenceRef.current ||
          !isCurrentPage(current.ownerKey, initial.conversationId, initial.snapshotTailEventId,
            page, latestInputRef.current, stateRef.current)) return false;
        messages = prependUnique(page.messages, messages);
        hasEarlier = page.hasEarlier;
        cursor = page.nextEarlierCursor;
        if (messages.some((message) => message.id === eventId)) {
          const next: PaginationState = {
            ownerKey: current.ownerKey,
            conversationId: initial.conversationId,
            snapshotTailEventId: initial.snapshotTailEventId,
            messages,
            hasEarlier,
            ...(cursor ? { nextEarlierCursor: cursor } : {}),
            revision: current.revision + 1
          };
          stateRef.current = next;
          pendingRevealRef.current = eventId;
          setState(next);
          return true;
        }
      }
      setFailed(true);
      return false;
    } catch {
      if (sequence === requestSequenceRef.current) setFailed(true);
      return false;
    } finally {
      if (sequence === requestSequenceRef.current) {
        requestActiveRef.current = false;
        setLoading(false);
      }
    }
  };

  const matchesOwner = state.ownerKey === input.ownerKey && (
    !input.initial || !state.conversationId || state.conversationId === input.initial.conversationId
  );
  return {
    messages: matchesOwner ? state.messages : input.initial?.messages ?? [],
    hasEarlier: matchesOwner ? state.hasEarlier : input.initial?.hasEarlier ?? false,
    loading,
    failed,
    loadEarlier,
    revealEvent
  };
}

export function ConversationEarlierControl(props: {
  readonly hasEarlier: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onLoadEarlier: (trigger: HTMLButtonElement) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (!props.hasEarlier && !props.loading && !props.failed) return null;
  return (
    <div className="conversation-earlier-control" data-conversation-earlier-control="true">
      <button
        type="button"
        className="quiet-button"
        disabled={props.loading || !props.hasEarlier}
        aria-busy={props.loading ? "true" : undefined}
        onClick={(event) => void props.onLoadEarlier(event.currentTarget)}
      >
        {props.t(props.loading ? "conversation.loadingEarlier" : "conversation.loadEarlier")}
      </button>
      {props.failed ? <span role="alert">{props.t("conversation.loadEarlierFailed")}</span> : null}
    </div>
  );
}

function emptyState(ownerKey: string, revision = 0): PaginationState {
  return { ownerKey, messages: [], hasEarlier: false, revision };
}

function stateFromInitial(ownerKey: string, initial: AgentConversationInitialTimeline, revision: number): PaginationState {
  return {
    ownerKey,
    conversationId: initial.conversationId,
    snapshotTailEventId: initial.snapshotTailEventId,
    messages: initial.messages,
    hasEarlier: initial.hasEarlier,
    ...(initial.nextEarlierCursor ? { nextEarlierCursor: initial.nextEarlierCursor } : {}),
    revision
  };
}

function mergeAppended(
  accumulated: readonly AgentConversationMessage[],
  latest: readonly AgentConversationMessage[]
): readonly AgentConversationMessage[] {
  if (accumulated.length === 0) return latest;
  const ids = new Set(accumulated.map((message) => message.id));
  const appended = latest.filter((message) => !ids.has(message.id));
  return appended.length === 0 ? accumulated : [...accumulated, ...appended];
}

function prependUnique(
  earlier: readonly AgentConversationMessage[],
  current: readonly AgentConversationMessage[]
): readonly AgentConversationMessage[] {
  const currentIds = new Set(current.map((message) => message.id));
  const prepended = earlier.filter((message) => !currentIds.has(message.id));
  return prepended.length === 0 ? current : [...prepended, ...current];
}

function isCurrentPage(
  ownerKey: string,
  conversationId: string,
  snapshotTailEventId: string,
  page: AgentConversationEarlierPage,
  input: { readonly ownerKey: string; readonly initial: AgentConversationInitialTimeline | undefined },
  state: PaginationState
): boolean {
  return input.ownerKey === ownerKey &&
    input.initial?.conversationId === conversationId &&
    input.initial.snapshotTailEventId === snapshotTailEventId &&
    state.ownerKey === ownerKey &&
    state.conversationId === conversationId &&
    state.snapshotTailEventId === snapshotTailEventId &&
    page.conversationId === conversationId &&
    page.snapshotTailEventId === snapshotTailEventId;
}
