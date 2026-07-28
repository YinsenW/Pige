import { useEffect, useRef, useState } from "react";
import type {
  AgentConversationHistoryCursor,
  AgentConversationHistorySummary
} from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

type HistoryState = {
  readonly conversations: readonly AgentConversationHistorySummary[];
  readonly currentConversationId?: string;
  readonly hasMore: boolean;
  readonly nextCursor?: AgentConversationHistoryCursor;
};

const EMPTY_HISTORY: HistoryState = { conversations: [], hasMore: false };

export function ConversationHistoryPanel(props: {
  readonly activeVaultId: string;
  readonly locale: string;
  readonly selectedConversationId: string | null;
  readonly disabled?: boolean;
  readonly onOpenConversation: (
    conversationId: string,
    view: "current" | "history"
  ) => Promise<boolean>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestSequenceRef = useRef(0);
  const operationRef = useRef(false);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  activeVaultIdRef.current = props.activeVaultId;

  useEffect(() => {
    requestSequenceRef.current += 1;
    operationRef.current = false;
    setExpanded(false);
    setHistory(EMPTY_HISTORY);
    setLoading(false);
    setFailed(false);
  }, [props.activeVaultId]);

  const loadHistory = async (cursor?: AgentConversationHistoryCursor): Promise<HistoryState | null> => {
    if (operationRef.current) return null;
    operationRef.current = true;
    setLoading(true);
    setFailed(false);
    const sequence = ++requestSequenceRef.current;
    const vaultId = props.activeVaultId;
    try {
      const result = await window.pige.agent.conversationHistory({
        apiVersion: 1,
        activeVaultId: vaultId,
        limit: 50,
        ...(cursor ? { cursor } : {})
      });
      if (sequence !== requestSequenceRef.current || activeVaultIdRef.current !== vaultId) return null;
      if (result.status !== "ready") {
        setFailed(true);
        return null;
      }
      const next: HistoryState = {
        conversations: cursor
          ? appendUnique(history.conversations, result.conversations)
          : result.conversations,
        ...(result.currentConversationId ? { currentConversationId: result.currentConversationId } : {}),
        hasMore: result.hasMore,
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
      };
      setHistory(next);
      return next;
    } catch {
      if (sequence === requestSequenceRef.current) setFailed(true);
      return null;
    } finally {
      if (sequence === requestSequenceRef.current) {
        operationRef.current = false;
        setLoading(false);
      }
    }
  };

  const toggle = async (): Promise<void> => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (history.conversations.length === 0 && !loading) await loadHistory();
  };

  const open = async (
    conversationId: string,
    view: "current" | "history",
    trigger: HTMLButtonElement
  ): Promise<void> => {
    if (operationRef.current || props.disabled) return;
    operationRef.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const opened = await props.onOpenConversation(conversationId, view);
      if (!opened) setFailed(true);
    } finally {
      operationRef.current = false;
      setLoading(false);
      window.requestAnimationFrame(() => {
        const target = trigger.isConnected ? trigger : historyTriggerRef.current;
        target?.focus({ preventScroll: true });
      });
    }
  };

  const openCurrent = async (trigger: HTMLButtonElement): Promise<void> => {
    const current = await loadHistory();
    if (!current?.currentConversationId) {
      if (current) setFailed(true);
      return;
    }
    await open(current.currentConversationId, "current", trigger);
  };

  return (
    <div data-conversation-history-panel="true">
      <div className="settings-inline-actions">
        <button
          ref={historyTriggerRef}
          type="button"
          className="quiet-button"
          aria-expanded={expanded}
          disabled={props.disabled}
          onClick={() => void toggle()}
        >
          <PigeIcon name="activity" size={14} />
          {props.t("conversation.history")}
        </button>
        {props.selectedConversationId ? (
          <button
            type="button"
            className="quiet-button"
            disabled={props.disabled || loading}
            onClick={(event) => void openCurrent(event.currentTarget)}
          >
            {props.t("conversation.current")}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="settings-card" aria-label={props.t("conversation.history")}>
          {history.conversations.map((conversation) => (
            <button
              type="button"
              className="settings-row"
              aria-current={props.selectedConversationId === conversation.conversationId ? "true" : undefined}
              disabled={props.disabled || loading}
              key={conversation.conversationId}
              onClick={(event) => void open(conversation.conversationId, "history", event.currentTarget)}
            >
              <span>
                <strong>{conversation.safePreview || props.t("conversation.previewUnavailable")}</strong>
                <small>{formatUpdatedAt(conversation.updatedAt, props.locale)}</small>
              </span>
            </button>
          ))}
          {!loading && history.conversations.length === 0 && !failed ? (
            <p className="settings-note">{props.t("conversation.historyEmpty")}</p>
          ) : null}
          {loading ? <p className="settings-note" role="status">{props.t("conversation.historyLoading")}</p> : null}
          {failed ? <p className="error" role="alert">{props.t("conversation.historyFailed")}</p> : null}
          {history.hasMore && history.nextCursor ? (
            <div className="settings-inline-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={loading}
                onClick={() => void loadHistory(history.nextCursor)}
              >
                {props.t("conversation.historyMore")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function appendUnique(
  current: readonly AgentConversationHistorySummary[],
  next: readonly AgentConversationHistorySummary[]
): readonly AgentConversationHistorySummary[] {
  const ids = new Set(current.map((conversation) => conversation.conversationId));
  return [...current, ...next.filter((conversation) => !ids.has(conversation.conversationId))];
}

function formatUpdatedAt(updatedAt: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt));
  } catch {
    return updatedAt;
  }
}
