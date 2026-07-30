import { useEffect, useRef, useState } from "react";
import type {
  AgentConversationHistoryCursor,
  AgentConversationHistorySummary
} from "@pige/contracts";
import { AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS } from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

type HistoryState = {
  readonly conversations: readonly AgentConversationHistorySummary[];
  readonly currentConversationId?: string;
  readonly hasMore: boolean;
  readonly nextCursor?: AgentConversationHistoryCursor;
};

type TitleEditorState = {
  readonly conversationId: string;
  readonly draft: string;
  readonly expectedTailEventId: string;
  readonly expectedTitleRevision: number;
  readonly saving: boolean;
  readonly failed: boolean;
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
  const [titleEditor, setTitleEditor] = useState<TitleEditorState | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [appliedQuery, setAppliedQuery] = useState<string | undefined>();
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
    setTitleEditor(null);
    setQueryDraft("");
    setAppliedQuery(undefined);
  }, [props.activeVaultId]);

  const loadHistory = async (
    cursor?: AgentConversationHistoryCursor,
    query: string | undefined = appliedQuery
  ): Promise<HistoryState | null> => {
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
        ...(cursor ? { cursor } : {}),
        ...(query ? { query } : {})
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
      setAppliedQuery(query);
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

  const search = async (query: string | undefined): Promise<void> => {
    if (titleEditor || props.disabled) return;
    const normalized = query?.trim() || undefined;
    const next = await loadHistory(undefined, normalized);
    if (next) setQueryDraft(normalized ?? "");
  };

  const openCurrent = async (trigger: HTMLButtonElement): Promise<void> => {
    const current = await loadHistory();
    if (!current?.currentConversationId) {
      if (current) setFailed(true);
      return;
    }
    await open(current.currentConversationId, "current", trigger);
  };

  const editTitle = (conversation: AgentConversationHistorySummary): void => {
    if (operationRef.current || props.disabled) return;
    setTitleEditor({
      conversationId: conversation.conversationId,
      draft: conversation.title ?? "",
      expectedTailEventId: conversation.tailEventId,
      expectedTitleRevision: conversation.titleRevision ?? 0,
      saving: false,
      failed: false
    });
  };

  const setTitle = async (title: string | null): Promise<void> => {
    if (!titleEditor || titleEditor.saving || operationRef.current || props.disabled) return;
    const editor = titleEditor;
    const vaultId = props.activeVaultId;
    operationRef.current = true;
    setTitleEditor({ ...editor, saving: true, failed: false });
    try {
      const requestId = createConversationTitleRequestId();
      const result = await window.pige.agent.setConversationTitle({
        apiVersion: 1,
        requestId,
        activeVaultId: vaultId,
        conversationId: editor.conversationId,
        expectedTailEventId: editor.expectedTailEventId,
        expectedTitleRevision: editor.expectedTitleRevision,
        title
      });
      if (activeVaultIdRef.current !== vaultId || result.requestId !== requestId ||
        result.activeVaultId !== vaultId || result.conversationId !== editor.conversationId) return;
      if (result.status === "committed" || result.status === "stale") {
        setHistory((current) => ({
          ...current,
          conversations: current.conversations
            .map((conversation) =>
              conversation.conversationId === result.summary.conversationId ? result.summary : conversation)
            .filter((conversation) => result.status === "stale" || !appliedQuery ||
              matchesConversationQuery(conversation, appliedQuery))
        }));
      }
      if (result.status === "committed") {
        setTitleEditor(null);
        window.requestAnimationFrame(() => {
          const target = document.querySelector<HTMLButtonElement>(
            `[data-conversation-title-edit="${editor.conversationId}"]`
          ) ?? document.querySelector<HTMLInputElement>(".conversation-search-form input") ?? historyTriggerRef.current;
          target?.focus({ preventScroll: true });
        });
      } else if (result.status === "stale") {
        setTitleEditor({
          ...editor,
          expectedTailEventId: result.summary.tailEventId,
          expectedTitleRevision: result.summary.titleRevision,
          saving: false,
          failed: true
        });
      } else {
        setTitleEditor({ ...editor, saving: false, failed: true });
      }
    } catch {
      if (activeVaultIdRef.current === vaultId) setTitleEditor({ ...editor, saving: false, failed: true });
    } finally {
      operationRef.current = false;
    }
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
          <form className="conversation-search-form" role="search" onSubmit={(event) => {
            event.preventDefault();
            void search(queryDraft);
          }}>
            <label>
              <span>{props.t("conversation.search")}</span>
              <input
                type="search"
                className="settings-input"
                maxLength={480}
                value={queryDraft}
                placeholder={props.t("conversation.searchPlaceholder")}
                disabled={props.disabled || loading || titleEditor !== null}
                onChange={(event) => {
                  setQueryDraft(event.currentTarget.value);
                  setFailed(false);
                }}
              />
            </label>
            <div className="settings-inline-actions">
              <button className="quiet-button" type="submit" disabled={props.disabled || loading ||
                titleEditor !== null || [...queryDraft.trim()].length > AGENT_CONVERSATION_HISTORY_QUERY_MAX_CODE_POINTS ||
                (queryDraft.trim() || undefined) === appliedQuery}>
                {props.t("conversation.searchAction")}
              </button>
              {appliedQuery ? (
                <button className="quiet-button" type="button" disabled={props.disabled || loading || titleEditor !== null}
                  onClick={() => void search(undefined)}>{props.t("conversation.searchClear")}</button>
              ) : null}
            </div>
          </form>
          {history.conversations.map((conversation) => (
            <div className="conversation-history-entry" key={conversation.conversationId}>
              <button
                type="button"
                className="settings-row"
                aria-current={props.selectedConversationId === conversation.conversationId ? "true" : undefined}
                disabled={props.disabled || loading || titleEditor?.saving}
                onClick={(event) => void open(conversation.conversationId, "history", event.currentTarget)}
              >
                <span>
                  <strong>{conversation.title ?? (conversation.safePreview || props.t("conversation.previewUnavailable"))}</strong>
                  <small>{formatUpdatedAt(conversation.updatedAt, props.locale)}</small>
                </span>
              </button>
              <button type="button" className="quiet-button conversation-title-edit"
                data-conversation-title-edit={conversation.conversationId}
                aria-label={`${props.t("conversation.rename")}: ${conversation.title ?? (conversation.safePreview || props.t("conversation.previewUnavailable"))}`}
                disabled={props.disabled || loading || titleEditor?.saving}
                onClick={() => editTitle(conversation)}>{props.t("conversation.rename")}</button>
              {titleEditor?.conversationId === conversation.conversationId ? (
                <form className="conversation-title-form" onSubmit={(event) => {
                  event.preventDefault();
                  void setTitle(titleEditor.draft.trim());
                }}>
                  <label>
                    <span>{props.t("conversation.titleLabel")}</span>
                    <input autoFocus className="settings-input" maxLength={480} value={titleEditor.draft}
                      disabled={titleEditor.saving} onChange={(event) => setTitleEditor({
                        ...titleEditor, draft: event.currentTarget.value, failed: false
                      })} />
                  </label>
                  <div className="settings-inline-actions">
                    <button className="quiet-button" type="submit"
                      disabled={titleEditor.saving || titleEditor.draft.trim().length === 0}>
                      {props.t(titleEditor.saving ? "conversation.titleSaving" : "conversation.titleSave")}
                    </button>
                    {conversation.title ? <button className="quiet-button" type="button"
                      disabled={titleEditor.saving} onClick={() => void setTitle(null)}>
                      {props.t("conversation.titleClear")}
                    </button> : null}
                    <button className="quiet-button" type="button" disabled={titleEditor.saving}
                      onClick={() => setTitleEditor(null)}>{props.t("conversation.titleCancel")}</button>
                  </div>
                  {titleEditor.failed ? <p className="error" role="alert">{props.t("conversation.titleFailed")}</p> : null}
                </form>
              ) : null}
            </div>
          ))}
          {!loading && history.conversations.length === 0 && !failed ? (
            <p className="settings-note">{props.t(appliedQuery ? "conversation.searchEmpty" : "conversation.historyEmpty")}</p>
          ) : null}
          {loading ? <p className="settings-note" role="status">{props.t("conversation.historyLoading")}</p> : null}
          {failed ? <p className="error" role="alert">{props.t("conversation.historyFailed")}</p> : null}
          {history.hasMore && history.nextCursor ? (
            <div className="settings-inline-actions">
              <button
                type="button"
                className="quiet-button"
                disabled={loading}
                onClick={() => void loadHistory(history.nextCursor, appliedQuery)}
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

function createConversationTitleRequestId(): `conversation_title_request_${string}` {
  return `conversation_title_request_${crypto.randomUUID().replaceAll("-", "")}`;
}

function appendUnique(
  current: readonly AgentConversationHistorySummary[],
  next: readonly AgentConversationHistorySummary[]
): readonly AgentConversationHistorySummary[] {
  const ids = new Set(current.map((conversation) => conversation.conversationId));
  return [...current, ...next.filter((conversation) => !ids.has(conversation.conversationId))];
}

function matchesConversationQuery(conversation: AgentConversationHistorySummary, query: string): boolean {
  const needle = normalizeSearchText(query);
  return normalizeSearchText(conversation.title ?? "").includes(needle) ||
    normalizeSearchText(conversation.safePreview).includes(needle);
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function formatUpdatedAt(updatedAt: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt));
  } catch {
    return updatedAt;
  }
}
