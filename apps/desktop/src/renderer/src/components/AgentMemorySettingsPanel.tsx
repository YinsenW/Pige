import { useEffect, useRef, useState } from "react";
import type {
  BackupMemoryPreferenceSummary,
  MemoryLifecycleMutationResult,
  MemoryRecordSummary,
  MemorySummary,
} from "@pige/schemas";
import { PigeIcon } from "./PigeIcon";

type Translate = (key: string) => string;
type PendingAction =
  | {
      readonly kind: "disable" | "enable" | "delete" | "edit";
      readonly memoryId: string;
    }
  | { readonly kind: "export" | "reset" };

interface MemoryEditDraft {
  readonly activeVaultId: string;
  readonly memoryId: string;
  readonly record: MemoryRecordSummary;
  readonly title: string;
  readonly body: string;
}

function createMemoryRequestId(): string {
  return `memory_request_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createBackupMemoryRequestId(): string {
  return `backupmemoryreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

export interface AgentMemorySettingsPanelProps {
  readonly activeVaultId: string | null;
  readonly focusRequest?: AgentMemoryFocusRequest | null;
  readonly onFocusRequestSettled?: (
    operationId: string,
    outcome: "focused" | "missing" | "failed",
  ) => void;
  readonly t: Translate;
}

export interface AgentMemoryFocusRequest {
  readonly activeVaultId: string;
  readonly operationId: string;
  readonly memoryId?: string;
}

export function AgentMemorySettingsPanel(
  props: AgentMemorySettingsPanelProps,
): React.JSX.Element {
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [readState, setReadState] = useState<
    "idle" | "loading" | "ready" | "failed"
  >("idle");
  const [reloadSequence, setReloadSequence] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [statusKey, setStatusKey] = useState<string | null>(null);
  const [backupPreference, setBackupPreference] = useState<BackupMemoryPreferenceSummary | null>(null);
  const [backupPreferenceState, setBackupPreferenceState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [backupPreferenceSaving, setBackupPreferenceSaving] = useState(false);
  const [backupPreferenceStatusKey, setBackupPreferenceStatusKey] = useState<string | null>(null);
  const backupPreferenceRequestActiveRef = useRef(false);
  const backupPreferenceSequenceRef = useRef(0);
  const backupPreferenceButtonRef = useRef<HTMLButtonElement>(null);
  const [editDraft, setEditDraft] = useState<MemoryEditDraft | null>(null);
  const mountedRef = useRef(true);
  const activeVaultIdRef = useRef(props.activeVaultId);
  const operationSequenceRef = useRef(0);
  const operationActiveRef = useRef(false);
  const editDraftRef = useRef<MemoryEditDraft | null>(null);
  const editCompositionRef = useRef(false);
  const editTitleRef = useRef<HTMLInputElement>(null);
  const editTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const settledFocusRequestRef = useRef<string | null>(null);
  const restoreEditFocusRef = useRef<string | null>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetConfirmRef = useRef<HTMLButtonElement>(null);
  activeVaultIdRef.current = props.activeVaultId;
  editDraftRef.current = editDraft;

  useEffect(() => {
    const requestedVaultId = props.activeVaultId;
    let current = true;
    backupPreferenceSequenceRef.current += 1;
    backupPreferenceRequestActiveRef.current = false;
    setBackupPreference(null);
    setBackupPreferenceStatusKey(null);
    setBackupPreferenceSaving(false);
    if (!requestedVaultId) {
      setBackupPreferenceState("idle");
      return () => { current = false; };
    }
    const backupApi = window.pige.backup;
    if (!backupApi?.memoryPreferenceStatus) {
      setBackupPreferenceState("failed");
      return () => { current = false; };
    }
    setBackupPreferenceState("loading");
    void backupApi.memoryPreferenceStatus().then((next) => {
      if (!current || activeVaultIdRef.current !== requestedVaultId || next.activeVaultId !== requestedVaultId) return;
      setBackupPreference(next);
      setBackupPreferenceState("ready");
    }).catch(() => {
      if (current && activeVaultIdRef.current === requestedVaultId) setBackupPreferenceState("failed");
    });
    return () => { current = false; };
  }, [props.activeVaultId]);

  useEffect(() => {
    mountedRef.current = true;
    operationSequenceRef.current += 1;
    operationActiveRef.current = false;
    const requestedVaultId = props.activeVaultId;
    let current = true;
    setSummary(null);
    setStatusKey(null);
    setPendingAction(null);
    setEditDraft(null);
    editCompositionRef.current = false;
    restoreEditFocusRef.current = null;
    setResetConfirmationOpen(false);
    if (!requestedVaultId) {
      setReadState("idle");
      return () => {
        current = false;
        mountedRef.current = false;
      };
    }
    const memoryApi = window.pige.memory;
    if (!memoryApi) {
      setReadState("failed");
      return () => {
        current = false;
        mountedRef.current = false;
      };
    }

    setReadState("loading");
    void memoryApi
      .list({ apiVersion: 1, activeVaultId: requestedVaultId })
      .then((next) => {
        if (
          !current ||
          activeVaultIdRef.current !== requestedVaultId ||
          next.activeVaultId !== requestedVaultId
        )
          return;
        setSummary(next);
        setReadState("ready");
      })
      .catch(() => {
        if (current && activeVaultIdRef.current === requestedVaultId)
          setReadState("failed");
      });
    return () => {
      current = false;
      mountedRef.current = false;
    };
  }, [props.activeVaultId, reloadSequence]);

  useEffect(() => {
    if (resetConfirmationOpen) resetConfirmRef.current?.focus();
  }, [resetConfirmationOpen]);

  useEffect(() => {
    const request = props.focusRequest;
    if (!request) {
      settledFocusRequestRef.current = null;
      return;
    }
    if (request.activeVaultId !== props.activeVaultId) return;
    const requestKey = `${request.activeVaultId}:${request.operationId}:${request.memoryId ?? "missing"}`;
    if (settledFocusRequestRef.current === requestKey) return;
    if (readState === "failed") {
      settledFocusRequestRef.current = requestKey;
      props.onFocusRequestSettled?.(request.operationId, "failed");
      return;
    }
    if (readState !== "ready" || summary?.activeVaultId !== request.activeVaultId) return;
    settledFocusRequestRef.current = requestKey;
    const exactTrigger = request.memoryId
      ? editTriggerRefs.current.get(request.memoryId)
      : undefined;
    (exactTrigger ?? panelHeadingRef.current)?.focus();
    props.onFocusRequestSettled?.(
      request.operationId,
      exactTrigger ? "focused" : "missing",
    );
  }, [
    props.activeVaultId,
    props.focusRequest,
    props.onFocusRequestSettled,
    readState,
    summary,
  ]);

  useEffect(() => {
    if (editDraft) {
      editTitleRef.current?.focus();
      return;
    }
    const memoryId = restoreEditFocusRef.current;
    restoreEditFocusRef.current = null;
    if (memoryId) editTriggerRefs.current.get(memoryId)?.focus();
  }, [editDraft?.activeVaultId, editDraft?.memoryId]);

  const beginAction = (action: PendingAction): number | null => {
    if (operationActiveRef.current) return null;
    const sequence = operationSequenceRef.current + 1;
    operationSequenceRef.current = sequence;
    operationActiveRef.current = true;
    setPendingAction(action);
    setStatusKey(null);
    return sequence;
  };

  const isCurrentAction = (sequence: number, vaultId: string): boolean =>
    mountedRef.current &&
    operationSequenceRef.current === sequence &&
    activeVaultIdRef.current === vaultId;

  const finishAction = (sequence: number, vaultId: string): void => {
    if (isCurrentAction(sequence, vaultId)) {
      operationActiveRef.current = false;
      setPendingAction(null);
    }
  };

  const adoptLifecycleResult = (
    result: MemoryLifecycleMutationResult,
    requestId: string,
    vaultId: string,
    sequence: number,
    completedKey: string,
  ): void => {
    if (!isCurrentAction(sequence, vaultId)) return;
    if (
      result.requestId !== requestId ||
      result.activeVaultId !== vaultId ||
      result.summary.activeVaultId !== vaultId
    ) {
      setStatusKey("memory.changeFailed");
      return;
    }
    setSummary(result.summary);
    setReadState("ready");
    setStatusKey(
      result.status === "committed"
        ? completedKey
        : result.status === "stale"
          ? "memory.changeStale"
          : "memory.changeNotFound",
    );
  };

  const mutateRecord = async (
    record: MemoryRecordSummary,
    kind: "disable" | "enable" | "delete",
  ): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary) return;
    if (
      (kind === "disable" && record.status !== "active") ||
      (kind === "enable" && record.status !== "disabled")
    )
      return;
    const sequence = beginAction({ kind, memoryId: record.id });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    try {
      const request = {
        apiVersion: 1 as const,
        requestId,
        activeVaultId: requestedVaultId,
        memoryId: record.id,
        expectedRevision: requestedSummary.revision,
      };
      if (kind === "disable") {
        const result = await memoryApi.disable(request);
        if (!isCurrentAction(sequence, requestedVaultId)) return;
        if (result.summary.activeVaultId !== requestedVaultId) {
          setStatusKey("memory.changeFailed");
          return;
        }
        setSummary(result.summary);
        setReadState("ready");
        setStatusKey(
          result.status === "committed"
            ? "memory.disableCompleted"
            : result.status === "stale"
              ? "memory.changeStale"
              : "memory.changeNotFound",
        );
      } else {
        const result =
          kind === "enable"
            ? await memoryApi.enable(request)
            : await memoryApi.delete(request);
        adoptLifecycleResult(
          result,
          requestId,
          requestedVaultId,
          sequence,
          kind === "enable"
            ? "memory.enableCompleted"
            : "memory.deleteCompleted",
        );
      }
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.changeFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const beginEdit = (record: MemoryRecordSummary): void => {
    const requestedSummary = summary;
    if (!requestedSummary || operationActiveRef.current || resetConfirmationOpen) return;
    setStatusKey(null);
    setEditDraft({
      activeVaultId: requestedSummary.activeVaultId,
      memoryId: record.id,
      record,
      title: record.title,
      body: record.body,
    });
  };

  const cancelEdit = (): void => {
    if (operationActiveRef.current) return;
    editCompositionRef.current = false;
    restoreEditFocusRef.current = editDraftRef.current?.memoryId ?? null;
    setEditDraft(null);
    setStatusKey(null);
  };

  const editRecord = async (): Promise<void> => {
    const requestedSummary = summary;
    const requestedDraft = editDraftRef.current;
    const memoryApi = window.pige.memory;
    if (
      !memoryApi ||
      !requestedSummary ||
      !requestedDraft ||
      editCompositionRef.current ||
      requestedDraft.activeVaultId !== requestedSummary.activeVaultId
    )
      return;
    const title = requestedDraft.title.trim();
    const body = requestedDraft.body.trim();
    if (!title || !body) return;
    const sequence = beginAction({
      kind: "edit",
      memoryId: requestedDraft.memoryId,
    });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    const isCurrentEdit = (): boolean => {
      const currentDraft = editDraftRef.current;
      return (
        isCurrentAction(sequence, requestedVaultId) &&
        currentDraft?.activeVaultId === requestedVaultId &&
        currentDraft.memoryId === requestedDraft.memoryId
      );
    };
    try {
      const result = await memoryApi.edit({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        memoryId: requestedDraft.memoryId,
        expectedRevision: requestedSummary.revision,
        title,
        body,
      });
      if (!isCurrentEdit()) return;
      if (
        result.requestId !== requestId ||
        result.activeVaultId !== requestedVaultId ||
        result.summary.activeVaultId !== requestedVaultId
      ) {
        setStatusKey("memory.editFailed");
        return;
      }
      setSummary(result.summary);
      setReadState("ready");
      if (result.status === "committed") {
        editCompositionRef.current = false;
        restoreEditFocusRef.current = requestedDraft.memoryId;
        setEditDraft(null);
        setStatusKey("memory.editCompleted");
      } else {
        setStatusKey(
          result.status === "stale"
            ? "memory.editStale"
            : "memory.editNotFound",
        );
      }
    } catch {
      if (isCurrentEdit()) setStatusKey("memory.editFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const exportMemory = async (): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary || editDraftRef.current) return;
    const sequence = beginAction({ kind: "export" });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    try {
      const result = await memoryApi.export({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        expectedRevision: requestedSummary.revision,
      });
      if (!isCurrentAction(sequence, requestedVaultId)) return;
      if (
        result.requestId !== requestId ||
        result.activeVaultId !== requestedVaultId
      ) {
        setStatusKey("memory.exportFailed");
      } else if (result.status === "exported" && result.revision === requestedSummary.revision) {
        setStatusKey("memory.exportCompleted");
      } else if (result.status === "stale") {
        setStatusKey("memory.exportStale");
        const current = await memoryApi.list({
          apiVersion: 1,
          activeVaultId: requestedVaultId,
        });
        if (
          isCurrentAction(sequence, requestedVaultId) &&
          current.activeVaultId === requestedVaultId
        ) {
          setSummary(current);
          setReadState("ready");
        }
      } else if (result.status === "failed" || result.status === "exported") {
        setStatusKey("memory.exportFailed");
      }
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.exportFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const resetMemory = async (): Promise<void> => {
    const requestedSummary = summary;
    const memoryApi = window.pige.memory;
    if (!memoryApi || !requestedSummary || editDraftRef.current) return;
    const sequence = beginAction({ kind: "reset" });
    if (sequence === null) return;
    const requestedVaultId = requestedSummary.activeVaultId;
    const requestId = createMemoryRequestId();
    setResetConfirmationOpen(false);
    try {
      const result = await memoryApi.reset({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        expectedRevision: requestedSummary.revision,
      });
      adoptLifecycleResult(
        result,
        requestId,
        requestedVaultId,
        sequence,
        "memory.resetCompleted",
      );
    } catch {
      if (isCurrentAction(sequence, requestedVaultId))
        setStatusKey("memory.changeFailed");
    } finally {
      finishAction(sequence, requestedVaultId);
    }
  };

  const closeResetConfirmation = (): void => {
    setResetConfirmationOpen(false);
    window.setTimeout(() => resetTriggerRef.current?.focus(), 0);
  };

  const toggleBackupPreference = async (): Promise<void> => {
    const current = backupPreference;
    if (!current || backupPreferenceRequestActiveRef.current || !current.canUpdate) return;
    const requestId = createBackupMemoryRequestId();
    const requestedVaultId = current.activeVaultId;
    const requestSequence = ++backupPreferenceSequenceRef.current;
    backupPreferenceRequestActiveRef.current = true;
    setBackupPreferenceSaving(true);
    setBackupPreferenceStatusKey(null);
    try {
      const result = await window.pige.backup.setMemoryPreference({
        apiVersion: 1,
        requestId,
        activeVaultId: requestedVaultId,
        expectedRevision: current.revision,
        includeVaultMemory: !current.includeVaultMemory,
      });
      if (
        requestSequence !== backupPreferenceSequenceRef.current ||
        activeVaultIdRef.current !== requestedVaultId ||
        result.requestId !== requestId ||
        result.activeVaultId !== requestedVaultId
      ) return;
      if (result.summary.activeVaultId !== requestedVaultId) {
        setBackupPreferenceStatusKey("memory.backupPreferenceFailed");
        return;
      }
      setBackupPreference(result.summary);
      setBackupPreferenceStatusKey(
        result.status === "updated"
          ? "memory.backupPreferenceSaved"
          : result.status === "blocked"
            ? "memory.backupPreferenceBlocked"
            : "memory.backupPreferenceStale",
      );
    } catch {
      if (activeVaultIdRef.current === requestedVaultId)
        setBackupPreferenceStatusKey("memory.backupPreferenceFailed");
    } finally {
      if (
        requestSequence === backupPreferenceSequenceRef.current &&
        activeVaultIdRef.current === requestedVaultId
      ) {
        backupPreferenceRequestActiveRef.current = false;
        setBackupPreferenceSaving(false);
        window.setTimeout(() => backupPreferenceButtonRef.current?.focus(), 0);
      }
    }
  };

  const busy = pendingAction !== null;
  const displayedRecords = summary
    ? editDraft &&
      editDraft.activeVaultId === summary.activeVaultId &&
      !summary.records.some((record) => record.id === editDraft.memoryId)
      ? [...summary.records, editDraft.record]
      : summary.records
    : [];

  return (
    <section
      className="settings-page memory-settings-page"
      aria-labelledby="settings-memory-title"
    >
      <header className="settings-panel-header">
        <h1 ref={panelHeadingRef} id="settings-memory-title" tabIndex={-1}>
          {props.t("memory.title")}
        </h1>
        <p>{props.t("memory.subtitle")}</p>
      </header>

      <section className="settings-section" role="group" aria-labelledby="memory-backup-title">
        <h2 className="settings-section-title" id="memory-backup-title">
          {props.t("memory.backupPreferenceSection")}
        </h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{props.t("memory.backupPreferenceTitle")}</strong>
              <span id="memory-backup-preference-description">
                {props.t("memory.backupPreferenceDescription")}
              </span>
              {backupPreferenceStatusKey ? (
                <span role="status">{props.t(backupPreferenceStatusKey)}</span>
              ) : null}
            </div>
            <button
              ref={backupPreferenceButtonRef}
              type="button"
              className="settings-switch"
              role="switch"
              aria-label={props.t("memory.backupPreferenceTitle")}
              aria-describedby="memory-backup-preference-description"
              aria-checked={backupPreference?.includeVaultMemory ?? false}
              aria-busy={backupPreferenceSaving || undefined}
              disabled={backupPreferenceState !== "ready" || backupPreferenceSaving || !backupPreference?.canUpdate}
              onClick={() => void toggleBackupPreference()}
            />
          </div>
        </div>
      </section>

      <section
        className="settings-section"
        role="group"
        aria-labelledby="memory-records-title"
      >
        <h2 className="settings-section-title" id="memory-records-title">
          {props.t("memory.savedMemories")}
        </h2>
        {!props.activeVaultId ? (
          <MemoryStateCard
            icon="folder"
            title={props.t("memory.noVaultTitle")}
            description={props.t("memory.noVaultDescription")}
          />
        ) : readState === "loading" ? (
          <MemoryStateCard
            icon="loading"
            title={props.t("memory.loadingTitle")}
            description={props.t("memory.loadingDescription")}
            loading
          />
        ) : readState === "failed" ? (
          <div className="settings-card memory-empty-card" role="alert">
            <PigeIcon name="shield" size={20} aria-hidden="true" />
            <div className="settings-row-copy">
              <strong>{props.t("memory.loadFailedTitle")}</strong>
              <span>{props.t("memory.loadFailedDescription")}</span>
            </div>
            <button
              className="settings-button"
              type="button"
              onClick={() => setReloadSequence((value) => value + 1)}
            >
              {props.t("memory.retryLoad")}
            </button>
          </div>
        ) : summary && displayedRecords.length > 0 ? (
          <div
            className="settings-card"
            data-memory-revision={summary.revision}
          >
            {displayedRecords.map((record) => {
              const editing =
                editDraft?.activeVaultId === summary.activeVaultId &&
                editDraft.memoryId === record.id;
              return (
              <div
                className="settings-row tall"
                data-memory-id={record.id}
                data-memory-editing={editing || undefined}
                key={record.id}
              >
                <span
                  className={`settings-list-icon ${record.status === "active" ? "is-enabled" : "neutral"}`}
                  aria-hidden="true"
                >
                  <PigeIcon name="memory" size={17} />
                </span>
                <div className="settings-row-copy">
                  {editing ? (
                    <form
                      aria-label={`${props.t("memory.edit")}: ${record.title}`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && event.nativeEvent.isComposing)
                          event.preventDefault();
                      }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!editCompositionRef.current) void editRecord();
                      }}
                    >
                      <label htmlFor={`memory-edit-title-${record.id}`}>
                        {props.t("memory.editTitle")}
                      </label>
                      <input
                        ref={editTitleRef}
                        className="settings-input"
                        id={`memory-edit-title-${record.id}`}
                        maxLength={120}
                        value={editDraft.title}
                        disabled={busy}
                        onInput={(event) => {
                          const title = event.currentTarget.value;
                          setEditDraft((current) =>
                            current
                              ? { ...current, title }
                              : current,
                          );
                        }}
                        onCompositionStart={() => {
                          editCompositionRef.current = true;
                        }}
                        onCompositionEnd={() => {
                          editCompositionRef.current = false;
                        }}
                      />
                      <label htmlFor={`memory-edit-body-${record.id}`}>
                        {props.t("memory.editBody")}
                      </label>
                      <textarea
                        className="settings-input"
                        id={`memory-edit-body-${record.id}`}
                        maxLength={2000}
                        rows={3}
                        value={editDraft.body}
                        disabled={busy}
                        onInput={(event) => {
                          const body = event.currentTarget.value;
                          setEditDraft((current) =>
                            current
                              ? { ...current, body }
                              : current,
                          );
                        }}
                        onCompositionStart={() => {
                          editCompositionRef.current = true;
                        }}
                        onCompositionEnd={() => {
                          editCompositionRef.current = false;
                        }}
                      />
                    </form>
                  ) : (
                    <>
                      <strong>{record.title}</strong>
                      <span>{record.body}</span>
                    </>
                  )}
                  <div
                    className="skill-registry-meta"
                    aria-label={props.t("memory.recordDetails")}
                  >
                    <span>{props.t(`memory.kind.${record.kind}`)}</span>
                    <span>{props.t(`memory.status.${record.status}`)}</span>
                    <span>
                      {props.t("memory.provenance")}:{" "}
                      {props.t("memory.provenance.explicitUserRequest")}
                    </span>
                    <time dateTime={record.provenance.occurredAt}>
                      {record.provenance.occurredAt}
                    </time>
                    <time dateTime={record.updatedAt}>
                      {props.t("memory.updated")}: {record.updatedAt}
                    </time>
                  </div>
                </div>
                <div className="settings-row-control">
                  <span
                    className={`settings-status ${record.status === "active" ? "is-enabled" : "neutral"}`}
                  >
                    {props.t(`memory.status.${record.status}`)}
                  </span>
                  {editing ? (
                    <>
                      <button
                        className="settings-button primary"
                        type="button"
                        disabled={
                          busy ||
                          editDraft.title.trim().length === 0 ||
                          editDraft.body.trim().length === 0
                        }
                        onClick={() => void editRecord()}
                      >
                        {pendingAction?.kind === "edit" &&
                        pendingAction.memoryId === record.id
                          ? props.t("memory.saving")
                          : props.t("memory.save")}
                      </button>
                      <button
                        className="settings-button"
                        type="button"
                        disabled={busy}
                        onClick={cancelEdit}
                      >
                        {props.t("memory.cancel")}
                      </button>
                    </>
                  ) : (
                    <button
                      ref={(node) => {
                        if (node) editTriggerRefs.current.set(record.id, node);
                        else editTriggerRefs.current.delete(record.id);
                      }}
                      className="settings-button"
                      type="button"
                      aria-label={`${props.t("memory.edit")}: ${record.title}`}
                      disabled={busy || editDraft !== null || resetConfirmationOpen}
                      onClick={() => beginEdit(record)}
                    >
                      {props.t("memory.edit")}
                    </button>
                  )}
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t(record.status === "active" ? "memory.disable" : "memory.enable")}: ${record.title}`}
                    disabled={busy || editDraft !== null}
                    title={props.t(
                      record.status === "active"
                        ? "memory.disableDescription"
                        : "memory.enableDescription",
                    )}
                    onClick={() =>
                      void mutateRecord(
                        record,
                        record.status === "active" ? "disable" : "enable",
                      )
                    }
                  >
                    {pendingAction?.kind ===
                      (record.status === "active" ? "disable" : "enable") &&
                    pendingAction.memoryId === record.id
                      ? props.t(
                          record.status === "active"
                            ? "memory.disabling"
                            : "memory.enabling",
                        )
                      : props.t(
                          record.status === "active"
                            ? "memory.disable"
                            : "memory.enable",
                        )}
                  </button>
                  <button
                    className="settings-button"
                    type="button"
                    aria-label={`${props.t("memory.delete")}: ${record.title}`}
                    disabled={busy || editDraft !== null}
                    title={props.t("memory.deleteDescription")}
                    onClick={() => void mutateRecord(record, "delete")}
                  >
                    {pendingAction?.kind === "delete" &&
                    pendingAction.memoryId === record.id
                      ? props.t("memory.deleting")
                      : props.t("memory.delete")}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        ) : readState === "ready" ? (
          <MemoryStateCard
            icon="memory"
            title={props.t("memory.emptyTitle")}
            description={props.t("memory.emptyDescription")}
          />
        ) : null}
        {summary ? (
          <div className="settings-inline-actions">
            <button
              className="settings-button settings-action"
              type="button"
              disabled={busy || editDraft !== null}
              onClick={() => void exportMemory()}
            >
              {pendingAction?.kind === "export"
                ? props.t("memory.exporting")
                : props.t("memory.export")}
            </button>
            <button
              ref={resetTriggerRef}
              className="settings-button settings-action"
              type="button"
              disabled={busy || editDraft !== null}
              aria-expanded={resetConfirmationOpen}
              aria-controls="memory-reset-confirmation"
              onClick={() => {
                if (editDraftRef.current) return;
                setResetConfirmationOpen(true);
                setStatusKey(null);
              }}
            >
              {props.t("memory.reset")}
            </button>
          </div>
        ) : null}
        {resetConfirmationOpen ? (
          <div
            className="settings-card"
            id="memory-reset-confirmation"
            role="alertdialog"
            aria-labelledby="memory-reset-title"
            aria-describedby="memory-reset-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeResetConfirmation();
            }}
          >
            <div className="settings-row-copy">
              <strong id="memory-reset-title">
                {props.t("memory.resetConfirmTitle")}
              </strong>
              <span id="memory-reset-description">
                {props.t("memory.resetConfirmDescription")}
              </span>
            </div>
            <div className="settings-inline-actions">
              <button
                className="settings-button"
                type="button"
                onClick={closeResetConfirmation}
              >
                {props.t("memory.cancel")}
              </button>
              <button
                ref={resetConfirmRef}
                className="settings-button primary"
                type="button"
                onClick={() => void resetMemory()}
              >
                {props.t("memory.resetConfirm")}
              </button>
            </div>
          </div>
        ) : null}
        {statusKey ? (
          <p className="settings-note" role="status" aria-live="polite">
            {props.t(statusKey)}
          </p>
        ) : null}
      </section>
    </section>
  );
}

function MemoryStateCard(props: {
  readonly icon: "folder" | "loading" | "memory";
  readonly title: string;
  readonly description: string;
  readonly loading?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="settings-card memory-empty-card"
      role="status"
      aria-live="polite"
    >
      <PigeIcon
        name={props.icon}
        size={20}
        className={props.loading ? "spinning" : undefined}
        aria-hidden="true"
      />
      <div className="settings-row-copy">
        <strong>{props.title}</strong>
        <span>{props.description}</span>
      </div>
    </div>
  );
}
