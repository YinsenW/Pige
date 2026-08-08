import { useEffect, useRef, useState } from "react";
import type {
  AgentConversationHistoryCursor,
  AgentConversationHistorySummary,
  AgentConversationExportRequest,
  ConversationTrashSummary
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
    view: "current" | "history",
    expectedTailEventId: string,
    searchMatchEventId?: string
  ) => Promise<boolean>;
  readonly onConversationTrashed: (conversationId: string) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trashExpanded, setTrashExpanded] = useState(false);
  const [trashed, setTrashed] = useState<readonly ConversationTrashSummary[]>([]);
  const [pendingTrash, setPendingTrash] = useState<AgentConversationHistorySummary | null>(null);
  const [pendingPurge, setPendingPurge] = useState<ConversationTrashSummary | null>(null);
  const [lifecycleNotice, setLifecycleNotice] = useState<"trashed" | "restored" | "purged" | "failed" | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<{ readonly conversationId: string; readonly status: "exported" | "stale" | "not_found" | "failed" } | null>(null);
  const [titleEditor, setTitleEditor] = useState<TitleEditorState | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [appliedQuery, setAppliedQuery] = useState<string | undefined>();
  const requestSequenceRef = useRef(0);
  const operationRef = useRef(false);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const historyRef = useRef(history);
  const historyTriggerRef = useRef<HTMLButtonElement | null>(null);
  const historyMoreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const exportTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  activeVaultIdRef.current = props.activeVaultId;
  historyRef.current = history;

  useEffect(() => {
    requestSequenceRef.current += 1;
    operationRef.current = false;
    setExpanded(false);
    setHistory(EMPTY_HISTORY);
    setLoading(false);
    setFailed(false);
    setTrashExpanded(false);
    setTrashed([]);
    setPendingTrash(null);
    setPendingPurge(null);
    setLifecycleNotice(null);
    setExportingId(null);
    setExportNotice(null);
    setTitleEditor(null);
    setQueryDraft("");
    setAppliedQuery(undefined);
    exportTriggerRefs.current.clear();
  }, [props.activeVaultId]);

  const loadHistory = async (
    cursor?: AgentConversationHistoryCursor,
    query: string | null | undefined = appliedQuery
  ): Promise<HistoryState | null> => {
    if (operationRef.current) return null;
    operationRef.current = true;
    setLoading(true);
    setFailed(false);
    const sequence = ++requestSequenceRef.current;
    const vaultId = props.activeVaultId;
    const effectiveQuery = query === null ? undefined : query;
    try {
      const result = await window.pige.agent.conversationHistory({
        apiVersion: 1,
        activeVaultId: vaultId,
        limit: 50,
        ...(cursor ? { cursor } : {}),
        ...(effectiveQuery ? { query: effectiveQuery } : {})
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
      setAppliedQuery(effectiveQuery);
      return next;
    } catch {
      if (sequence === requestSequenceRef.current) setFailed(true);
      return null;
    } finally {
      if (sequence === requestSequenceRef.current) {
        operationRef.current = false;
        setLoading(false);
        if (cursor) {
          window.requestAnimationFrame(() => {
            const target = historyMoreTriggerRef.current;
            (target?.isConnected ? target : historyTriggerRef.current)?.focus({ preventScroll: true });
          });
        }
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
    conversation: AgentConversationHistorySummary,
    view: "current" | "history",
    trigger: HTMLButtonElement
  ): Promise<void> => {
    if (operationRef.current || props.disabled) return;
    operationRef.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const opened = await props.onOpenConversation(
        conversation.conversationId,
        view,
        conversation.tailEventId,
        conversation.searchMatch?.eventId
      );
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
    const current = await loadHistory(undefined, null);
    if (!current?.currentConversationId) {
      if (current) setFailed(true);
      return;
    }
    const summary = current.conversations.find(({ conversationId }) =>
      conversationId === current.currentConversationId
    );
    if (!summary) {
      setFailed(true);
      return;
    }
    await open(summary, "current", trigger);
  };

  const exportConversation = async (conversation: AgentConversationHistorySummary): Promise<void> => {
    if (operationRef.current || props.disabled) return;
    operationRef.current = true;
    setExportingId(conversation.conversationId);
    setExportNotice(null);
    const sequence = ++requestSequenceRef.current;
    const request: AgentConversationExportRequest = {
      apiVersion: 1,
      requestId: `conversation_export_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
      activeVaultId: props.activeVaultId,
      conversationId: conversation.conversationId,
      expectedTailEventId: conversation.tailEventId
    };
    try {
      const result = await window.pige.agent.exportConversation(request);
      const current = historyRef.current.conversations.find(({ conversationId }) =>
        conversationId === request.conversationId
      );
      if (sequence !== requestSequenceRef.current ||
          activeVaultIdRef.current !== request.activeVaultId ||
          current?.tailEventId !== request.expectedTailEventId ||
          result.requestId !== request.requestId ||
          result.activeVaultId !== request.activeVaultId ||
          result.conversationId !== request.conversationId) return;
      if (result.status !== "cancelled") {
        setExportNotice({ conversationId: request.conversationId, status: result.status });
      }
    } catch {
      if (sequence === requestSequenceRef.current && activeVaultIdRef.current === request.activeVaultId) {
        setExportNotice({ conversationId: request.conversationId, status: "failed" });
      }
    } finally {
      if (sequence === requestSequenceRef.current) {
        operationRef.current = false;
        setExportingId(null);
        window.requestAnimationFrame(() => {
          const trigger = exportTriggerRefs.current.get(request.conversationId);
          (trigger?.isConnected ? trigger : historyTriggerRef.current)?.focus({ preventScroll: true });
        });
      }
    }
  };

  const loadTrash = async (): Promise<void> => {
    if (operationRef.current) return;
    operationRef.current = true;
    setLoading(true);
    setFailed(false);
    const sequence = ++requestSequenceRef.current;
    const vaultId = props.activeVaultId;
    try {
      const result = await window.pige.agent.conversationTrash({ apiVersion: 1, activeVaultId: vaultId });
      if (sequence !== requestSequenceRef.current || activeVaultIdRef.current !== vaultId) return;
      if (result.status !== "ready") { setFailed(true); return; }
      setTrashed(result.conversations);
    } catch {
      if (sequence === requestSequenceRef.current) setFailed(true);
    } finally {
      if (sequence === requestSequenceRef.current) {
        operationRef.current = false;
        setLoading(false);
      }
    }
  };

  const toggleTrash = async (): Promise<void> => {
    const next = !trashExpanded;
    setTrashExpanded(next);
    if (next) await loadTrash();
  };

  const confirmTrash = async (): Promise<void> => {
    const conversation = pendingTrash;
    if (!conversation?.revision || operationRef.current || props.disabled) return;
    operationRef.current = true;
    setLoading(true);
    setLifecycleNotice(null);
    const vaultId = props.activeVaultId;
    try {
      const result = await window.pige.agent.trashConversation({
        apiVersion: 1,
        requestId: `conversationtrashreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: vaultId,
        conversationId: conversation.conversationId,
        expectedRevision: conversation.revision
      });
      if (activeVaultIdRef.current !== vaultId) return;
      if (result.status !== "committed") { setLifecycleNotice("failed"); return; }
      props.onConversationTrashed(conversation.conversationId);
      setPendingTrash(null);
      setLifecycleNotice("trashed");
      setHistory(EMPTY_HISTORY);
      await Promise.all([loadTrashUnlocked(vaultId), loadHistoryUnlocked(vaultId)]);
    } catch {
      setLifecycleNotice("failed");
    } finally {
      operationRef.current = false;
      setLoading(false);
    }
  };

  const restore = async (conversation: ConversationTrashSummary): Promise<void> => {
    if (operationRef.current || props.disabled) return;
    operationRef.current = true;
    setLoading(true);
    setLifecycleNotice(null);
    const vaultId = props.activeVaultId;
    try {
      const result = await window.pige.agent.restoreConversation({
        apiVersion: 1,
        requestId: `conversationtrashreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: vaultId,
        trashEntryId: conversation.trashEntryId,
        conversationId: conversation.conversationId,
        expectedRevision: conversation.revision
      });
      if (activeVaultIdRef.current !== vaultId) return;
      if (result.status !== "restored" && result.status !== "already_restored") { setLifecycleNotice("failed"); return; }
      setLifecycleNotice("restored");
      setHistory(EMPTY_HISTORY);
      await Promise.all([loadTrashUnlocked(vaultId), loadHistoryUnlocked(vaultId)]);
    } catch {
      setLifecycleNotice("failed");
    } finally {
      operationRef.current = false;
      setLoading(false);
    }
  };

  const purge = async (): Promise<void> => {
    const conversation = pendingPurge;
    if (!conversation || operationRef.current || props.disabled) return;
    operationRef.current = true;
    setLoading(true);
    setLifecycleNotice(null);
    const vaultId = props.activeVaultId;
    try {
      const result = await window.pige.agent.purgeConversation({
        apiVersion: 1,
        requestId: `conversationpurgereq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`,
        activeVaultId: vaultId,
        trashEntryId: conversation.trashEntryId,
        conversationId: conversation.conversationId,
        expectedRevision: conversation.revision,
        confirmation: "delete_permanently"
      });
      if (activeVaultIdRef.current !== vaultId) return;
      if (result.status !== "committed") { setLifecycleNotice("failed"); return; }
      setTrashed((current) => current.filter(({ trashEntryId }) => trashEntryId !== conversation.trashEntryId));
      setPendingPurge(null);
      setLifecycleNotice("purged");
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>("[data-conversation-trash-toggle='true']")?.focus({ preventScroll: true });
      });
    } catch {
      setLifecycleNotice("failed");
    } finally {
      operationRef.current = false;
      setLoading(false);
    }
  };

  const loadTrashUnlocked = async (vaultId: string): Promise<void> => {
    const result = await window.pige.agent.conversationTrash({ apiVersion: 1, activeVaultId: vaultId });
    if (activeVaultIdRef.current === vaultId && result.status === "ready") setTrashed(result.conversations);
  };

  const loadHistoryUnlocked = async (vaultId: string): Promise<void> => {
    const result = await window.pige.agent.conversationHistory({ apiVersion: 1, activeVaultId: vaultId, limit: 50 });
    if (activeVaultIdRef.current === vaultId && result.status === "ready") setHistory({
      conversations: result.conversations,
      ...(result.currentConversationId ? { currentConversationId: result.currentConversationId } : {}),
      hasMore: result.hasMore,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {})
    });
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
            .map((conversation) => conversation.conversationId === result.summary.conversationId
              ? { ...result.summary, ...(conversation.searchMatch ? { searchMatch: conversation.searchMatch } : {}) }
              : conversation)
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
        <button type="button" className="quiet-button" data-conversation-trash-toggle="true" disabled={props.disabled || loading} aria-expanded={trashExpanded} onClick={() => void toggleTrash()}>
          {props.t("conversation.trash")}
        </button>
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
            <div className="settings-row conversation-history-row conversation-history-entry" key={conversation.conversationId}>
              <button
                type="button"
                className="conversation-history-open"
                aria-current={props.selectedConversationId === conversation.conversationId ? "true" : undefined}
                disabled={props.disabled || loading || titleEditor?.saving}
                onClick={(event) => void open(conversation, "history", event.currentTarget)}
              >
                <span>
                  <strong>{conversation.title ?? (conversation.safePreview || props.t("conversation.previewUnavailable"))}</strong>
                  <small>{formatUpdatedAt(conversation.updatedAt, props.locale)}</small>
                  {conversation.searchMatch ? (
                    <small data-conversation-search-match={conversation.searchMatch.eventId}>
                      {props.t(conversation.searchMatch.role === "user" ? "home.userMessage" : "home.assistantMessage")}: {conversation.searchMatch.safeExcerpt}
                    </small>
                  ) : null}
                </span>
              </button>
              <div className="settings-inline-actions">
                <button type="button" className="quiet-button conversation-title-edit"
                  data-conversation-title-edit={conversation.conversationId}
                  aria-label={`${props.t("conversation.rename")}: ${conversation.title ?? (conversation.safePreview || props.t("conversation.previewUnavailable"))}`}
                  disabled={props.disabled || loading || titleEditor?.saving || exportingId !== null}
                  onClick={() => editTitle(conversation)}>{props.t("conversation.rename")}</button>
                {conversation.revision && props.selectedConversationId !== conversation.conversationId ? (
                  <button type="button" className="quiet-button"
                    disabled={props.disabled || loading || titleEditor?.saving || exportingId !== null}
                    onClick={() => { setPendingTrash(conversation); setLifecycleNotice(null); }}>
                    {props.t("conversation.moveToTrash")}
                  </button>
                ) : null}
                <button type="button" className="quiet-button"
                  ref={(button) => {
                    if (button) exportTriggerRefs.current.set(conversation.conversationId, button);
                    else exportTriggerRefs.current.delete(conversation.conversationId);
                  }}
                  disabled={props.disabled || loading || titleEditor?.saving || exportingId !== null}
                  onClick={() => void exportConversation(conversation)}>
                  {props.t(exportingId === conversation.conversationId ? "conversation.exporting" : "conversation.export")}
                </button>
              </div>
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
          {pendingTrash ? (
            <div className="settings-row conversation-trash-confirm" role="group" aria-label={props.t("conversation.trashConfirmPrompt")}>
              <span><strong>{props.t("conversation.trashConfirmPrompt")}</strong><small>{pendingTrash.safePreview}</small></span>
              <div className="settings-inline-actions">
                <button type="button" className="quiet-button" onClick={() => setPendingTrash(null)}>{props.t("conversation.trashCancel")}</button>
                <button type="button" className="quiet-button" onClick={() => void confirmTrash()}>{props.t("conversation.trashConfirm")}</button>
              </div>
            </div>
          ) : null}
          {exportNotice ? <p className={exportNotice.status === "exported" ? "settings-note" : "error"}
            role={exportNotice.status === "exported" ? "status" : "alert"}>
            {props.t(`conversation.export_${exportNotice.status}`)}
          </p> : null}
          {!loading && history.conversations.length === 0 && !failed ? (
            <p className="settings-note">{props.t(appliedQuery ? "conversation.searchEmpty" : "conversation.historyEmpty")}</p>
          ) : null}
          {loading ? <p className="settings-note" role="status">{props.t("conversation.historyLoading")}</p> : null}
          {failed ? <p className="error" role="alert">{props.t("conversation.historyFailed")}</p> : null}
          {history.hasMore && history.nextCursor ? (
            <div className="settings-inline-actions">
              <button
                ref={historyMoreTriggerRef}
                data-conversation-history-more="true"
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
      {trashExpanded ? (
        <div className="settings-card" aria-label={props.t("conversation.trash") }>
          {trashed.map((conversation) => (
            <div className="settings-row conversation-history-row" key={conversation.trashEntryId}>
              <span><strong>{conversation.safePreview}</strong><small>{formatUpdatedAt(conversation.trashedAt, props.locale)}</small></span>
              <div className="settings-inline-actions">
                <button type="button" className="quiet-button" disabled={props.disabled || loading || pendingPurge !== null}
                  onClick={() => void restore(conversation)}>{props.t("conversation.restore")}</button>
                <button type="button" className="quiet-button" disabled={props.disabled || loading || pendingPurge !== null}
                  onClick={() => { setPendingPurge(conversation); setLifecycleNotice(null); }}>
                  {props.t("conversation.deletePermanently")}
                </button>
              </div>
              {pendingPurge?.trashEntryId === conversation.trashEntryId ? (
                <div className="conversation-trash-confirm" role="group" aria-label={props.t("conversation.purgeConfirmPrompt") }>
                  <p className="settings-note">{props.t("conversation.purgeConfirmPrompt")}</p>
                  <div className="settings-inline-actions">
                    <button type="button" className="quiet-button" disabled={loading}
                      onClick={() => setPendingPurge(null)}>{props.t("conversation.trashCancel")}</button>
                    <button type="button" className="quiet-button" disabled={loading}
                      onClick={() => void purge()}>{props.t("conversation.purgeConfirm")}</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {!loading && trashed.length === 0 ? <p className="settings-note">{props.t("conversation.trashEmpty")}</p> : null}
        </div>
      ) : null}
      {lifecycleNotice ? <p className={lifecycleNotice === "failed" ? "error" : "settings-note"} role={lifecycleNotice === "failed" ? "alert" : "status"}>{props.t(`conversation.lifecycle.${lifecycleNotice}`)}</p> : null}
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
    normalizeSearchText(conversation.safePreview).includes(needle) ||
    conversation.searchMatch !== undefined;
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
